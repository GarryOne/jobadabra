import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('fast path fills only safe known fields and reports gaps without values', () => {
  class HTMLInputElement {
    constructor(id, type = 'text') {
      this.id = id; this.name = id; this.type = type; this.tagName = 'INPUT';
      this.value = ''; this.labels = []; this.disabled = false; this.readOnly = false;
    }
    getClientRects() { return [1]; }
    getAttribute() { return null; }
    matches(selector) { return selector.includes(`input[type="${this.type}"]`) ||
      (this.type === 'text' && selector.includes('input[type="text"]')); }
    dispatchEvent() {}
    addEventListener() {}
  }
  Object.defineProperty(HTMLInputElement.prototype, 'value', {
    get() { return this._value || ''; }, set(value) { this._value = value; },
  });
  class HTMLTextAreaElement {}
  const email = new HTMLInputElement('email', 'email');
  const legal = new HTMLInputElement('privacy_consent', 'checkbox');
  legal.labels = [{textContent: 'I agree to privacy terms'}];
  const submit = new HTMLInputElement('submit', 'submit');
  const elements = [email, legal, submit];
  const document = {querySelectorAll(selector) { return /role=combobox/.test(selector) ? [] : elements; }};   // no custom dropdowns on this page
  const window = {__jobPilottoGuardActive: true};
  const code = fs.readFileSync(new URL('../../tools/browser-form-fastpath.js', import.meta.url), 'utf8');
  // The one control reader loads first, as everywhere the fastpath runs (the extension's PAGE_FILES, the apply run's init scripts): its audit asks it.
  const context = vm.createContext({window, document, HTMLInputElement, HTMLTextAreaElement, getComputedStyle: () => ({visibility: 'visible'}), Event: class {}});
  for (const file of ['../../extension/page/typed-check.js', '../../extension/page/read-back.js']) vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), context);
  vm.runInContext(code, context);
  const outcome = window.__jobPilottoFillKnownFields([
    {field: 'email', value: 'sample@example.test'},
    {field: 'privacy_consent', value: 'yes'},
    {field: 'submit', value: 'clicked'},
    {field: 'unknown', value: 'anything'},
  ]);
  assert.deepEqual(Array.from(outcome.filled), ['email']);
  assert.equal(email.value, 'sample@example.test');
  assert.equal(legal.value, '');
  assert.equal(submit.value, '');
  const audited = window.__jobPilottoAuditVisibleFields();
  assert.equal(audited.length, 2);
  assert.equal(audited[0].filled, true);
  assert.equal(audited[1].legal, true);
  assert.equal(JSON.stringify(outcome).includes('sample@example.test'), false);
});

test('option picker needs an exact match, so "Male" never picks "Female"', () => {
  const clicked = [];
  const option = text => ({textContent: text, offsetParent: {}, children: [],
    getBoundingClientRect: () => ({x: 0, y: 0, width: 10, height: 10}), click() { clicked.push(text); }});
  const options = [option('Female'), option('Male'), option('Decline To Self Identify')];
  const document = {querySelectorAll: selector => (selector.includes('option') ? options : [])};
  const window = {__jobPilottoGuardActive: true};
  const code = fs.readFileSync(new URL('../../tools/browser-form-fastpath.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, {window, document, HTMLInputElement: class {}, HTMLTextAreaElement: class {},
    getComputedStyle: () => ({visibility: 'visible'}), Event: class {}, innerHeight: 800});
  assert.equal(window.__jobPilottoClickOption('male').ok, true);
  assert.deepEqual(clicked, ['Male']);
  const missing = window.__jobPilottoClickOption('Other');
  assert.equal(missing.ok, false);
  assert.equal(missing.why, 'no exact match');
});

test('fast path types fields for the Chrome extension, which switches the guard off', () => {
  class HTMLInputElement {
    constructor(id) { this.id = id; this.name = id; this.type = 'text'; this.tagName = 'INPUT'; this.labels = []; }
    getClientRects() { return [1]; }
    getAttribute() { return null; }
    matches(selector) { return selector.includes('input[type="text"]'); }
    dispatchEvent() {}
    addEventListener() {}
  }
  Object.defineProperty(HTMLInputElement.prototype, 'value', {
    get() { return this._value || ''; }, set(value) { this._value = value; },
  });
  const first = new HTMLInputElement('first_name');
  const document = {querySelectorAll() { return [first]; }};
  const window = {__jobPilottoGuardActive: false, __jobPilottoNoGuard: true};
  const code = fs.readFileSync(new URL('../../tools/browser-form-fastpath.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, {window, document, HTMLInputElement, HTMLTextAreaElement: class {},
    getComputedStyle: () => ({visibility: 'visible'}), Event: class {}});
  const outcome = window.__jobPilottoFillKnownFields([{field: 'first_name', value: 'Ada'}]);
  assert.deepEqual(Array.from(outcome.filled), ['first_name']);
  assert.equal(first.value, 'Ada');
});

test('a read-only box (a date picker keeps its box so) takes a date while empty; nothing else read-only is written', () => {
  class HTMLInputElement {
    constructor(id) { this.id = id; this.name = id; this.type = 'text'; this.tagName = 'INPUT'; this.labels = []; this.disabled = false; this.readOnly = true; }
    getClientRects() { return [1]; }
    getAttribute() { return null; }
    matches(selector) { return selector.includes('input[type="text"]'); }
    dispatchEvent() {}
    addEventListener() {}
    focus() {}
    blur() {}
    setAttribute() {}
  }
  Object.defineProperty(HTMLInputElement.prototype, 'value', {get() { return this._value || ''; }, set(value) { this._value = value; }});
  const start = new HTMLInputElement('start_on'), name = new HTMLInputElement('full_name'), taken = new HTMLInputElement('ends_on');
  taken.value = '01.01.2027';
  const elements = [start, name, taken];
  const window = {__jobPilottoGuardActive: true, __jobPilottoValueClass: {of: value => (/^\d\d\.\d\d\.\d{4}$/.test(value) ? 'date' : 'free_text')}};
  const context = vm.createContext({window, document: {querySelectorAll: () => elements}, HTMLInputElement, HTMLTextAreaElement: class {}, getComputedStyle: () => ({visibility: 'visible'}), Event: class {}});
  for (const file of ['../../extension/page/typed-check.js', '../../extension/page/read-back.js']) vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../../tools/browser-form-fastpath.js', import.meta.url), 'utf8'), context);
  const outcome = window.__jobPilottoFillKnownFields([
    {field: 'start_on', value: '14.11.2026'}, {field: 'full_name', value: 'Sample Person'}, {field: 'ends_on', value: '02.02.2027'},
  ]);
  assert.deepEqual(Array.from(outcome.filled), ['start_on']);
  assert.deepEqual(Array.from(outcome.skipped), ['full_name', 'ends_on']);
  assert.equal(start.value, '14.11.2026');
  assert.equal(name.value, '');
  assert.equal(taken.value, '01.01.2027');
});

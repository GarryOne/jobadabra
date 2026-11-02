// The fill types a box again, once, when a page's own autofill emptied it after the upload; never a box the person touched or the page filled (tools/browser-form-fastpath.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function page(clock = {now: 0}) {
  class HTMLInputElement {
    constructor(id, type = 'text') {
      this.id = id; this.name = id; this.type = type; this.tagName = 'INPUT'; this.labels = []; this.disabled = false; this.readOnly = false;
      this.isConnected = true; this.listeners = [];
    }
    getClientRects() { return [1]; }
    getAttribute(name) { return this.attrs?.[name] ?? null; }
    setAttribute(name, value) { (this.attrs ||= {})[name] = String(value); }
    hasAttribute(name) { return !!this.attrs && name in this.attrs; }
    removeAttribute(name) { if (this.attrs) delete this.attrs[name]; }
    matches(selector) { return selector.includes(`input[type="${this.type}"]`); }
    addEventListener(type, fn) { if (type === 'input') this.listeners.push(fn); }
    dispatchEvent() {}
    focus() {}
    blur() {}
  }
  Object.defineProperty(HTMLInputElement.prototype, 'value', {get() { return this._value || ''; }, set(value) { this._value = value; }});
  class HTMLTextAreaElement {}
  const boxes = ['first', 'last', 'link', 'mail'].map(id => new HTMLInputElement(id));
  const window = {__jobPilottoGuardActive: true};
  const code = fs.readFileSync(new URL('../../tools/browser-form-fastpath.js', import.meta.url), 'utf8');
  const context = vm.createContext({window, document: {querySelectorAll: () => boxes}, HTMLInputElement, HTMLTextAreaElement,
    getComputedStyle: () => ({visibility: 'visible'}), Event: class {}, Date: Object.assign(function () { return new globalThis.Date(clock.now); }, {now: () => clock.now}),
    setInterval: fn => { clock.tick = fn; return 1; }, clearInterval: () => { clock.tick = null; }});
  // The one attempt log the retypes ask (extension/page/attempts.js), loaded first as everywhere the fastpath runs.
  vm.runInContext(fs.readFileSync(new URL('../../extension/page/attempts.js', import.meta.url), 'utf8'), context);
  vm.runInContext(code, context);
  window.__jobPilottoFillKnownFields(boxes.map(box => ({field: box.id, value: `typed-${box.id}`})));
  // A re-render: the element leaves the page, a new empty one with the same id takes its place.
  const replace = index => { const old = boxes[index], fresh = new HTMLInputElement(old.id); old.isConnected = false; old._value = ''; boxes[index] = fresh; return fresh; };
  return {window, boxes, replace};
}

test('a box the page emptied after the fill is typed again, once', () => {
  const {window, boxes} = page();
  boxes[0]._value = ''; boxes[1]._value = '';
  assert.equal(window.__jobadabraRetypeWiped(), 2);
  assert.deepEqual(boxes.map(box => box.value), ['typed-first', 'typed-last', 'typed-link', 'typed-mail']);
  boxes[0]._value = '';
  assert.equal(window.__jobadabraRetypeWiped(), 1, 'a page that empties it again is typed into again');
  assert.equal(boxes[0].value, 'typed-first');
});

test('a page that keeps clearing a box is typed into a few times, then left, and the field is named', () => {
  const {window, boxes} = page();
  let typed = 0;
  for (let round = 0; round < 12; round++) { boxes[0]._value = ''; typed += window.__jobadabraRetypeWiped(); }
  assert.equal(typed, window.__jobadabraAttempts.CAP, 'the box\'s one attempt log: a few tries in all (page/attempts.js)');
  assert.equal(boxes[0].value, '');
  assert.equal(JSON.stringify(window.__jobadabraRetypeGaveUp()), JSON.stringify([{field: 'first', times: window.__jobadabraAttempts.CAP}]));
  assert.deepEqual(boxes.slice(1).map(box => box.value), ['typed-last', 'typed-link', 'typed-mail']);
});

test('the watch outlives its first window while the page keeps emptying, and catches a wipe after 15 s', () => {
  const clock = {now: 1000};
  const {window, boxes} = page(clock);
  window.__jobadabraRetypeWiped(15000);
  clock.now += 14000; boxes[1]._value = ''; clock.tick();
  assert.equal(boxes[1].value, 'typed-last', 'a wipe late in the window is typed again');
  clock.now += 14000; boxes[1]._value = ''; clock.tick();
  assert.equal(boxes[1].value, 'typed-last', 'that retype extended the watch: a second wipe 14 s later is still caught');
  clock.now += 120000; clock.tick();
  assert.equal(clock.tick, null, 'the watch ends, whatever the page does (hard cap)');
});

test('a box the person touched, or the page filled itself, is never typed over', () => {
  const {window, boxes} = page();
  boxes[0]._value = ''; boxes[0].listeners.forEach(fn => fn({isTrusted: true}));   // the person cleared it
  boxes[1]._value = 'the page wrote this';
  boxes[2]._value = ''; boxes[2].listeners.forEach(fn => fn({isTrusted: false}));   // a script's event is not the person
  assert.equal(window.__jobadabraRetypeWiped(), 1);
  assert.equal(boxes[0].value, '');
  assert.equal(boxes[1].value, 'the page wrote this');
  assert.equal(boxes[2].value, 'typed-link');
});

test('a box the page replaced by a new element (a re-render keeps its id) is found again and typed', () => {
  const {window, boxes, replace} = page();
  const old = boxes[0];
  const fresh = replace(0);   // the old element is gone from the page, a new empty one stands in its place
  assert.equal(fresh.value, '');
  assert.equal(window.__jobadabraRetypeWiped(), 1);
  assert.equal(fresh.value, 'typed-first');
  assert.equal(old.isConnected, false);
});

test('a replaced box the person touched is left alone', () => {
  const {window, boxes, replace} = page();
  boxes[0].listeners.forEach(fn => fn({isTrusted: true}));
  const fresh = replace(0);
  assert.equal(window.__jobadabraRetypeWiped(), 0);
  assert.equal(fresh.value, '');
});

test('a box the page put back on a bare country code (a phone widget\'s own "+972") is typed again; any other value the page wrote stays', () => {
  const {window, boxes} = page();
  boxes[0]._value = '+972'; boxes[1]._value = '+41'; boxes[2]._value = '+41 79 5'; boxes[3]._value = 'the page wrote this';
  assert.equal(window.__jobadabraRetypeWiped(), 2);
  assert.deepEqual(boxes.map(box => box.value), ['typed-first', 'typed-last', '+41 79 5', 'the page wrote this']);
});

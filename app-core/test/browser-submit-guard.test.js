import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadedGuard() {
  const listeners = {};
  const created = [];
  const document = {
    addEventListener(type, listener) { listeners[type] = listener; },
    createElement() {
      const el = {style: {}, append() {}, remove() {},
        addEventListener(type, listener) { this[type] = listener; }};
      created.push(el);
      return el;
    },
    documentElement: {append() {}},
  };
  function HTMLFormElement() {}
  HTMLFormElement.prototype.submit = function () { return 'submitted'; };
  HTMLFormElement.prototype.requestSubmit = function () { return 'requested'; };
  const window = {confirm: () => false};
  const code = fs.readFileSync(new URL('../../tools/browser-submit-guard.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, {window, document, HTMLFormElement});
  return {listeners, window, HTMLFormElement, created};
}

function event(target) {
  return {target, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }};
}

test('guard blocks submit methods and submit events', () => {
  const {listeners, HTMLFormElement, window} = loadedGuard();
  assert.equal(window.__jobPilottoGuardActive, true);
  const form = new HTMLFormElement();
  assert.throws(() => form.submit(), /blocked/);
  assert.throws(() => form.requestSubmit(), /blocked/);
  const attempted = event(form);
  listeners.submit(attempted);
  assert.equal(attempted.prevented, true);
  assert.equal(attempted.stopped, true);
});

test('guard blocks submit buttons and legal consent clicks', () => {
  const {listeners} = loadedGuard();
  const button = {type: 'submit', id: 'send', textContent: 'Apply now',
    getAttribute() { return null; }, closest(selector) { return selector.startsWith('button') ? this : null; }};
  const submitClick = event(button);
  listeners.click(submitClick);
  assert.equal(submitClick.prevented, true);
  const checkbox = {type: 'checkbox', checked: true, id: 'privacy', textContent: '',
    labels: [{textContent: 'I agree to the privacy notice'}], getAttribute() { return null; },
    closest(selector) { return selector.startsWith('input') ? this : null; }};
  const consentClick = event(checkbox);
  listeners.click(consentClick);
  assert.equal(consentClick.prevented, true);
  listeners.change(event(checkbox));
  assert.equal(checkbox.checked, false);
});

test('guard releases only after explicit review confirmation', () => {
  const {listeners, window, HTMLFormElement, created} = loadedGuard();
  listeners.DOMContentLoaded();
  const release = created[2];
  release.click({stopPropagation() {}});
  assert.equal(window.__jobPilottoGuardActive, true);
  window.confirm = () => true;
  release.click({stopPropagation() {}});
  assert.equal(window.__jobPilottoGuardActive, false);
  assert.equal(new HTMLFormElement().submit(), 'submitted');
});

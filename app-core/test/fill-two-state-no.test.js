// A two-state control (checkbox, switch, single yes/no toggle) whose answer is "no" already holds it unchecked: the trace keeps it as answered, never "the field did not take it".
// Found by an offline replay (14 Oct 2026): a required "I am an employee of the group" box, answered no, was reported as a typing failure after guesses were typed (5b13328).
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();
const KINDS = {
  checkbox: '<label for="emp">I am an employee of the group</label><input id="emp" type="checkbox" required>',
  switch: '<label for="emp">I am an employee of the group</label><input id="emp" type="checkbox" role="switch" required>',
  toggle: '<label for="emp">I am an employee of the group</label><input id="emp" type="checkbox" class="toggle" aria-required="true" required>',
};

for (const [kind, html] of Object.entries(KINDS)) {
  for (const value of ['no', 'false', 'unchecked']) {
    test(`${kind} answered "${value}" and left unchecked is kept, not "did not take it"`, {skip: !JSDOM}, async () => {
      const window = openPage(JSDOM, `<form>${html}</form>`, {url: 'https://example.com/apply'});
      const summary = await window.__jobadabraExtensionFill([{field: 'emp', value, question: 'I am an employee of the group', source: 'Claude (on the page)', guess: true}], {}, null, '', false);
      const row = (summary.trace || []).find(item => /employee/.test(item.label));
      assert.ok(row, 'the box is traced');
      assert.equal(window.document.getElementById('emp').checked, false, 'nothing was pressed');
      assert.doesNotMatch(row.reason, /did not take/);
      assert.equal(row.reason, 'answered no: left unchecked');
    });
  }
}

test('a box answered yes that stays unchecked is still "did not take it"', {skip: !JSDOM}, async () => {
  const window = openPage(JSDOM, `<form>${KINDS.checkbox}</form>`, {url: 'https://example.com/apply'});
  window.document.getElementById('emp').addEventListener('click', event => event.preventDefault());
  const summary = await window.__jobadabraExtensionFill([{field: 'emp', value: 'yes', question: 'I am an employee of the group', source: 'kit'}], {}, null, '', false);
  assert.match((summary.trace || []).find(item => /employee/.test(item.label)).reason, /did not take/);
});

const answered = async (html, value, tweak) => {
  const window = openPage(JSDOM, `<form>${html}</form>`, {url: 'https://example.com/apply'});
  tweak?.(window.document.getElementById('emp'));
  const summary = await window.__jobadabraExtensionFill([{field: 'emp', value, question: 'I am an employee of the group', source: 'Claude (on the page)'}], {}, null, '', false);
  return (summary.trace || []).find(item => /employee/.test(item.label)).reason;
};

test('a pre-ticked box answered no is never reported as "answered no: left unchecked"', {skip: !JSDOM}, async () => {
  // The fill reads a ticked box as filled and skips it (page/fill.js), so the new reason must not claim the state it never checked.
  const reason = await answered(KINDS.checkbox.replace('required', 'required checked'), 'unchecked', box => box.addEventListener('click', event => event.preventDefault()));
  assert.doesNotMatch(reason, /answered no/);
});

test('an empty or unknown answer is never read as no', {skip: !JSDOM}, async () => {
  for (const value of ['', 'Ja', 'Oui', 'maybe']) assert.doesNotMatch(await answered(KINDS.checkbox, value), /answered no/, `"${value}"`);
});

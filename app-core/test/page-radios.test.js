// ARIA radio groups (extension/page/radios.js): a role=radiogroup of role=radio elements that are not inputs, whose question and option words
// live in OTHER elements (aria-labelledby), is read as one choice field, answered by the option whose name is the answer, and counted.
// The shape of SuccessFactors' questions (9 Oct 2026: 9 required questions were "question on the page not read"), Workday's and many
// React kits'. Legal options are never picked (the fill's floor).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const group = (id, question, options) => `
  <div class="question"><label id="${id}-q">* ${question}</label>
    <div role="radiogroup" id="${id}" aria-labelledby="${id}-q">
      ${options.map((text, i) => `<span role="radio" aria-checked="false" tabindex="0" aria-labelledby="${id}-o${i}"><span class="dot"></span></span>
        <label id="${id}-o${i}">${text}</label>`).join('')}
    </div></div>`;
const FORM = `<form><label for="name">Full name *</label><input id="name" required>
  ${group('employed', 'Are you or were you employed by this group?', ['Yes', 'No'])}
  ${group('terms', 'I accept the terms of use', ['I accept', 'I do not accept'])}
</form>`;

// The widget's own behaviour: a click checks this option and unchecks the others of its group.
function behave(window) {
  for (const radio of window.document.querySelectorAll('[role=radio]')) {
    radio.addEventListener('click', () => {
      for (const other of radio.closest('[role=radiogroup]').querySelectorAll('[role=radio]')) other.setAttribute('aria-checked', 'false');
      radio.setAttribute('aria-checked', 'true');
    });
  }
}

test('an ARIA radio group is read as one choice field: its question and options by their accessible names', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  const fields = await window.__jobPilottoDescribeForm();
  const employed = fields.find((field) => field.field === 'aria:employed');
  assert.ok(employed, 'the group is a field');
  assert.equal(employed.label, 'Are you or were you employed by this group?');
  assert.equal(employed.type, 'radio');
  assert.equal(employed.required, true);   // the "*" before the question
  assert.deepEqual(Array.from(employed.options), ['Yes', 'No']);   // the words live in other elements
  assert.equal(employed.filled, false);
  assert.equal(fields.find((field) => field.field === 'aria:terms').legal, true);
});

test('the answer picks the option by its name, the field counts as filled, and nothing is left "not read"', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  behave(window);
  const summary = await window.__jobPilottoExtensionFill([
    { field: 'name', value: 'Ada Tester', source: 'kit' },
    { field: 'aria:employed', value: 'No', source: 'kit' },
    { field: 'aria:terms', value: 'I accept', source: 'kit' },
  ], {}, null, '', false);
  const no = window.document.querySelector('[aria-labelledby="employed-o1"]');
  assert.equal(no.getAttribute('aria-checked'), 'true');
  assert.equal(window.document.querySelector('[aria-labelledby="terms-o0"]').getAttribute('aria-checked'), 'false');   // legal: never ours
  const trace = Array.from(summary.trace);
  assert.equal(trace.filter((row) => row.reason === 'question on the page not read' && /employed/.test(row.label)).length, 0);
  assert.equal(trace.find((row) => row.label === 'Are you or were you employed by this group?')?.outcome, 'filled');
});

test('an unanswered ARIA question is listed as left, by its question, not as unread', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  behave(window);
  const summary = await window.__jobPilottoExtensionFill([{ field: 'name', value: 'Ada Tester', source: 'kit' }], {}, null, '', false);
  const row = Array.from(summary.trace).find((item) => item.label === 'Are you or were you employed by this group?');
  assert.ok(row, 'listed');
  assert.notEqual(row.outcome, 'filled');
  assert.notEqual(row.reason, 'question on the page not read');
});

test('a proposal for an ARIA question is kept on its group, for the panel and the app\'s "Needs your attention" row', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  window.__jobPilottoMarkProposal({ field: 'aria:employed', filled: false, legal: false, options: ['Yes', 'No'] }, { value: 'No' });
  const group = window.document.getElementById('employed');
  assert.equal(group.dataset.jobpilottoSuggested, 'No');
  assert.deepEqual(JSON.parse(group.dataset.jobpilottoOptions), ['Yes', 'No']);
});

test('the AI\'s likely answer (use: propose) is never typed: it is the question\'s proposal, marked as a guess, "proposed for you to confirm"', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  behave(window);
  const summary = await window.__jobPilottoExtensionFill([
    { field: 'name', value: 'Ada Tester', source: 'kit' },
    { field: 'aria:employed', value: 'No', source: 'Claude (on the page)', use: 'propose', category: 'normal' },
  ], {}, null, '', false);
  const group = window.document.getElementById('employed');
  assert.equal(window.document.querySelector('[aria-labelledby="employed-o1"]').getAttribute('aria-checked'), 'false');   // not picked for you
  assert.equal(group.dataset.jobpilottoSuggested, 'No');
  assert.equal(group.dataset.jobpilottoGuess, '1');
  const row = Array.from(summary.trace).find((item) => item.label === 'Are you or were you employed by this group?');
  assert.equal(row.outcome, 'left');
  assert.equal(row.reason, 'proposed for you to confirm');
  assert.equal(window.document.getElementById('name').value, 'Ada Tester');   // a stated answer is still typed
});

// Pressable buttons as a choice group (Ashby's Yes/No: two aria-pressed buttons under one parent, the title in a label above). Found by
// structure, not by the words Yes/No; read as the same field shape as an ARIA radio group, with the same legal floor.
const toggle = (title, options, extra = '') => `
  <div class="entry"><label class="_heading_x _required_x title">${title}</label>
    <div class="_yesno_x" ${extra}>${options.map(text => `<button type="button" aria-pressed="false">${text}</button>`).join('')}</div>
    <input type="checkbox" hidden></div>`;
const TOGGLES = `<form><label for="name">Full name *</label><input id="name" required>
  ${toggle('Are you authorized to work here?', ['Yes', 'No'])}
  ${toggle('Wie gross ist Ihr Team?', ['Klein', 'Mittel', 'Gross'])}
  ${toggle('I accept the terms', ['I accept', 'I do not accept'])}
  <div class="entry"><label class="title">Additional information</label>
    <div role="toolbar"><button type="button" aria-pressed="false">Bold</button><button type="button" aria-pressed="false">Italic</button></div>
    <textarea id="more"></textarea></div>
</form>`;
function pressing(window) {
  for (const button of window.document.querySelectorAll('button[aria-pressed]')) {
    button.addEventListener('click', () => {
      for (const other of button.parentElement.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
    });
  }
}

test('a group of pressable buttons is read as one choice field, by structure: its title above, its buttons as options, in any language', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, TOGGLES);
  const fields = (await window.__jobPilottoDescribeForm()).filter((field) => String(field.field).startsWith('aria:'));
  assert.deepEqual(Array.from(fields.map((field) => field.label)), ['Are you authorized to work here?', 'Wie gross ist Ihr Team?', 'I accept the terms']);
  const [yesNo, team] = fields;
  assert.equal(yesNo.type, 'radio');
  assert.equal(yesNo.required, true);   // the title's own "required" class
  assert.deepEqual(Array.from(yesNo.options), ['Yes', 'No']);
  assert.deepEqual(Array.from(team.options), ['Klein', 'Mittel', 'Gross']);
  assert.equal(yesNo.filled, false);
  assert.equal(fields[2].legal, true);
  // Not a question: a rich-text toolbar's pressable buttons.
  assert.ok(!fields.some((field) => /Bold/.test(String(field.options))), 'a toolbar is not a question');
});

test('the answer presses the button by its name, counts as filled, and nothing is left "not read"; a legal option is never pressed', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, TOGGLES);
  pressing(window);
  const form = await window.__jobPilottoDescribeForm();
  const keyOf = (label) => form.find((field) => field.label === label).field;
  const summary = await window.__jobPilottoExtensionFill([
    { field: 'name', value: 'Ada Tester', source: 'kit' },
    { field: keyOf('Are you authorized to work here?'), value: 'No', source: 'kit' },
    { field: keyOf('Wie gross ist Ihr Team?'), value: 'Mittel', source: 'kit' },
    { field: keyOf('I accept the terms'), value: 'I accept', source: 'kit' },
  ], {}, null, '', false);
  const pressed = (text) => Array.from(window.document.querySelectorAll('button')).find((button) => button.textContent === text).getAttribute('aria-pressed');
  assert.equal(pressed('No'), 'true');
  assert.equal(pressed('Yes'), 'false');
  assert.equal(pressed('Mittel'), 'true');
  assert.equal(pressed('I accept'), 'false');
  const trace = Array.from(summary.trace);
  assert.equal(trace.filter((row) => row.reason === 'question on the page not read' && /authorized/.test(row.label)).length, 0);
  assert.equal(trace.find((row) => row.label === 'Are you authorized to work here?')?.outcome, 'filled');
});

test('an unanswered pressable-button question is listed as left, by its question, not as unread', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, TOGGLES);
  pressing(window);
  const summary = await window.__jobPilottoExtensionFill([{ field: 'name', value: 'Ada Tester', source: 'kit' }], {}, null, '', false);
  const row = Array.from(summary.trace).find((item) => item.label === 'Are you authorized to work here?');
  assert.ok(row, 'listed');
  assert.notEqual(row.outcome, 'filled');
  assert.notEqual(row.reason, 'question on the page not read');
});

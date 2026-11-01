// A yes/no step before the form (15 Oct 2026, Aldi's application start): a question sentence, plain buttons for its answers (no aria-pressed, no form), and a "Continue" that stays disabled until one is chosen.
// The reader lists such a group as a field (extension/page/radios.js: structure only, and only while a disabled control waits for an answer), so the question goes the answer path every other field takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const STEP = `<main><p class="q">You are applying for an apprenticeship. Do you want to continue?</p>
  <div class="choices"><button type="button" id="a">Oui</button><button type="button" id="b">Non</button></div>
  <div class="nav"><button type="button" id="back">Retour</button><button type="button" id="next" disabled>Continuer</button></div></main>`;

test('a plain yes/no button group with a disabled next control is read as one question with its options', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, STEP);
  const summary = await window.__jobPilottoExtensionFill([], {}, null, '', false);
  const rows = Array.from(summary.trace);
  const question = rows.find((row) => /apprenticeship/.test(row.label || ''));
  assert.ok(question, `the question is a field: ${JSON.stringify(rows.map((row) => row.label))}`);
  assert.equal(question.type, 'radio');
  assert.equal(question.outcome, 'left', 'with no answer it stays the person\'s: nothing is pressed');
  assert.equal(window.document.getElementById('next').disabled, true);
});

test('a sure answer presses the button it names; the waiting control comes alive (the effect is the proof), then Continue is a press like any other', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, STEP);
  window.document.getElementById('a').addEventListener('click', () => { window.document.getElementById('next').disabled = false; });
  const summary = await window.__jobPilottoExtensionFill([{ field: 'aria:g1', value: 'Oui', source: 'kit' }], {}, null, '', false);
  const row = Array.from(summary.trace).find((one) => /apprenticeship/.test(one.label || ''));
  assert.equal(row.outcome, 'filled', JSON.stringify(row));
  assert.equal(window.document.getElementById('next').disabled, false);
});

test('a press that switches nothing on is not taken as an answer', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, STEP);
  const summary = await window.__jobPilottoExtensionFill([{ field: 'aria:g1', value: 'Oui', source: 'kit' }], {}, null, '', false);
  const row = Array.from(summary.trace).find((one) => /apprenticeship/.test(one.label || ''));
  assert.notEqual(row.outcome, 'filled', JSON.stringify(row));
});

test('the same buttons with no control waiting for an answer are not a question (a card with two buttons is not a field)', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, STEP.replace(' disabled', ''));
  const summary = await window.__jobPilottoExtensionFill([], {}, null, '', false);
  assert.ok(!Array.from(summary.trace).some((row) => /apprenticeship/.test(row.label || '')));
});

// The flow's page rule (extension/tab-pages.js pageRole): a page with such a group is a step of the application (form), the same buttons with nothing waiting are not.
import { pageRole } from '../../extension/tab-pages.js';
test('pageRole: a counted question step is a form step; none counted keeps the old rule', () => {
  assert.equal(pageRole({ choices: 1 }, 'https://apply.example.test/a/1'), 'form');
  assert.equal(pageRole({ choices: 0 }, 'https://apply.example.test/a/1'), 'no-form');
  assert.equal(pageRole({ fields: 2 }, 'https://apply.example.test/a/1'), 'no-form');
});

test('the shared finder returns the group only while a control waits, and never a form\'s, a dialog\'s or a toolbar\'s buttons', { skip: !JSDOM }, () => {
  const count = (html) => openPage(JSDOM, html).__jobPilottoChoiceStep.groups({ isVisible: () => true }).length;
  assert.equal(count(STEP), 1);
  assert.equal(count(STEP.replace(' disabled', '')), 0);
  assert.equal(count(`<form>${STEP}</form>`), 0);
  assert.equal(count(`<dialog open>${STEP}</dialog>`), 0);
  assert.equal(count(STEP.replace('<div class="choices">', '<div class="choices" role="toolbar">')), 0);
  assert.equal(count(STEP.replace('<button type="button" id="b">Non</button>', '')), 0, 'one button is not a choice');
});

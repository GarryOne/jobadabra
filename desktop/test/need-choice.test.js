// Needs your attention, simpler row controls (owner, 27 Oct 2026: "how can the user agree or not on the proposed answer?", "the remember
// should be... maybe we should not ask the user"): the proposal is a button that agrees in one click, Change… opens the other answers;
// a missing fact has no Remember tick (Fill it in keeps it, Forget undoes it). Code: renderer/pages/need-choice.js, session-needs.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {choiceButtons} from '../renderer/pages/need-choice.js';
import {answerOptions} from '../renderer/answer-options.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(here, '..', 'renderer', file), 'utf8');
// A stand-in button: its words, its role and what a press does.
const fake = () => {
  const made = [];
  const button = (text, run, role) => { const b = {text, run, role, title: ''}; made.push(b); return b; };
  return {made, button};
};

test('the proposal is one press that agrees (the old dropdown showed it pre-selected, so picking it did nothing)', () => {
  const picked = [];
  const {button} = fake();
  const choices = answerOptions({recommended: 'keep it', label: 'How did you hear'}, [], {claude: true});
  const [agree, change] = choiceButtons(choices, {button, pick: choice => picked.push(choice), change: () => picked.push('change')});
  assert.equal(agree.text, '✓ Keep it');
  assert.equal(agree.role, 'answer');
  agree.run();
  assert.deepEqual(picked.map(choice => choice.kind), ['proposed']);
  assert.equal(change.text, 'Change…');
  change.run();
  assert.equal(picked.at(-1), 'change');
});

test('Change… is on every row with a proposal or a field: your saved answers and a box, filled in by the extension (no Claude needed)', () => {
  const saved = [{question: 'Pay', answer: 'Not below 160k'}];
  const cases = [
    [{recommended: 'apply anyway', label: 'Pay'}, [], false, ['✓ Apply anyway', 'Change…']],    // Claude help off, nothing saved: still a way to change
    [{recommended: 'apply anyway', label: 'Pay'}, saved, false, ['✓ Apply anyway', 'Change…']],
    [{label: 'Pay'}, [], true, ['Change…']],                                                     // no proposal: your own words for the field
    [{label: 'Pay'}, [], false, ['Change…']],
    [{text: 'The cover letter says openly…'}, [], false, []],                                    // a note, no field: Review in form alone
    [{text: 'The cover letter says openly…'}, [], true, ['Change…']],                            // a note, Claude help on: tell Claude (was Tell Claude…)
  ];
  for (const [need, answers, claude, want] of cases) {
    const {made, button} = fake();
    choiceButtons(answerOptions(need, answers, {claude}), {button, pick() {}, change() {}, field: need.label || ''});
    assert.deepEqual(made.map(b => b.text), want, JSON.stringify({need, claude}));
  }
});

test('an answer you give reaches the form through the extension; Claude\'s batch only as the fallback with Claude help on', () => {
  const send = read('pages/need-send.js');
  const at = send.indexOf('export async function sendAnswer');
  assert.ok(at >= 0, 'sendAnswer found');
  const body = send.slice(at, at + 700);
  assert.match(body, /window\.pilot\.sessionFillField\(item\.id, label, value\)/);
  assert.match(body, /if \(resumeOffered\(\)\) \{ queue\(/);
  const needs = read('pages/session-needs.js');
  assert.equal((needs.match(/sendAnswer\(item, key, /g) || []).length, 2, 'Fill it in and Change… both send through sendAnswer');
});

test('a missing fact has no Remember tick: Fill it in keeps the answer, Forget makes it this application only', () => {
  const source = read('pages/session-needs.js');
  assert.doesNotMatch(source, /type = 'checkbox'/, 'the Remember tick is back');
  assert.doesNotMatch(source, /'ss-answer-select'|el\('select'/, 'the Proposed answer dropdown is back');
  const ask = source.slice(source.indexOf('export function askRow'));
  assert.match(ask, /window\.pilot\.rememberAnswer\(need\.question, value\)/, 'Fill it in no longer keeps the answer');
  assert.match(source, /window\.pilot\.jobQuestionOnly\(question\)/, 'Forget is gone');
});

test('every need row ends with its quiet Review/Open in form button (one column, same size)', () => {
  const source = read('pages/session-needs.js') + read('pages/need-proposal.js');
  const reviewKinds = [...source.matchAll(/smallButton\('(?:Review in form|Open in form|Open the form)', '([^']*)'/g)].map(m => m[1]);
  assert.ok(reviewKinds.length >= 3, 'found the review buttons');
  for (const kind of reviewKinds) assert.match(kind, /\bis-review\b/);
  assert.match(read('style.css'), /\.ss-need-actions > \.ss-need-button \{[^}]*min-width: 112px/);
  // Each role its own border (owner, 27 Oct 2026: "let's have different border color for every button").
  const css = read('style.css');
  const border = role => (new RegExp(`\\.ss-need-button\\.is-${role} \\{[^}]*border-color: ([^;]+);`).exec(css) || [])[1];
  const borders = ['answer', 'change', 'review'].map(border);
  assert.ok(borders.every(Boolean), `a role has no border colour: ${borders}`);
  assert.equal(new Set(borders).size, 3, `two roles share a border colour: ${borders}`);
  // The row's main button is solid (owner: "a solid/distinctive background for the main button"): the primary's amber, AA text on it.
  assert.match(css, /\.ss-need-button\.is-answer \{[^}]*background: var\(--signal-solid\);[^}]*color: var\(--on-signal\)/);   // amber, as primary (owner: "revert here to amber")
});

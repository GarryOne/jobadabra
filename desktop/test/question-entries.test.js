// The Jobs drawers as rows of Focus → Suggestions and the Jobs bar (renderer/question-entries.js; spec docs/superpowers/specs/2026-10-28-insights-with-actions-design.md,
// PR 1c): Cover letter, Fill your details and What we learned keep every state of the cards they replace, come first in that order, and ⋯ holds Not now only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {LOOK, jobsBarWords} from '../renderer/suggestions.js';
import {QUESTION_DOES, drawerRows, foldedLine, questionEntries, withQuestions} from '../renderer/question-entries.js';

const asked = {details: [{}, {}, {}, {}], learned: [{}, {}, {}, {}, {}, {}], letter: {hint: 'Forms ask for one', setup: {action: 'Create cover letter', state: 'missing'}}, error: '', fromDetails: 0, read: true};

test('each drawer is one row with its count, its one button and the drawer it opens; the cover letter is the blocking one', () => {
  const rows = questionEntries(asked);
  assert.deepEqual(rows.map(row => row.kind), ['letter', 'details', 'learned']);
  assert.deepEqual(rows.map(row => row.actions.map(action => action.do)), [['open_letter'], ['open_details'], ['open_learned']]);
  assert.equal(rows[0].actions[0].label, 'Create cover letter', "the card's own wording");
  assert.match(rows[1].detail, /4 missing/);
  assert.match(rows[2].detail, /6 to check/);
  assert.equal(rows.filter(row => row.blocking).length, 1);
  assert.ok(rows[0].blocking, 'forms go without a letter');
});

test('every state of today\'s cards stays: hidden at zero, answered-from-details line, could not load + Retry, no store yet', () => {
  assert.deepEqual(questionEntries({...asked, details: [], learned: [], letter: null}), [], 'hidden at zero');
  const some = questionEntries({...asked, letter: null, fromDetails: 3});
  assert.match(some[0].detail, /3/, 'the "answered from your details" line stays on the details row');
  const failed = questionEntries({...asked, details: [], learned: [], letter: null, error: 'notion 500'});
  assert.deepEqual(failed.map(row => row.kind), ['questions-error'], 'a failed read shows one row, no counts');
  assert.deepEqual(failed[0].actions.map(action => action.do), ['retry_questions']);
  assert.deepEqual(questionEntries({details: [], learned: [], letter: null, error: 'Connect Notion first'}), [], 'the store not connected yet (trying only): no error row');
});

test('the rows answer Not now only, and every do they write has a handler and a look', () => {
  for (const row of questionEntries(asked)) assert.deepEqual(row.answers, ['Not now'], `${row.kind}: counts, not guesses`);
  for (const kind of ['letter', 'details', 'learned', 'questions-error']) assert.ok(LOOK[kind], `${kind} has a look`);
  const page = fs.readFileSync(new URL('../renderer/pages/focus-suggestions.js', import.meta.url), 'utf8');
  const run = page.slice(page.indexOf('export const RUN = {'), page.indexOf('\n};', page.indexOf('export const RUN = {')));
  const written = new Set(questionEntries(asked).concat(questionEntries({error: 'x'})).flatMap(row => row.actions.map(action => action.do)));
  assert.deepEqual([...written].sort(), QUESTION_DOES.slice().sort(), 'QUESTION_DOES lists what the rows write');
  for (const name of QUESTION_DOES) assert.match(run, new RegExp(`\\n  ${name}: `), `${name} has a handler in RUN`);
});

test('the question rows come first, the blocking one at the very top, then today\'s insight and the rest in their order', () => {
  const insight = {kind: 'insight', key: 'insight:k', title: 'Insight', actions: [], answers: ['Not now', 'Not true']};
  const tune = {kind: 'tune', key: 'tune:k', title: 'Tune', actions: [], answers: ['Not now', 'Not true']};
  assert.deepEqual(withQuestions([insight, tune], questionEntries(asked)).map(row => row.kind), ['letter', 'details', 'learned', 'insight', 'tune']);
  assert.deepEqual(withQuestions([insight], questionEntries({...asked, letter: null})).map(row => row.kind), ['details', 'learned', 'insight']);
});

test('the folded line names them, the blocking one first, then the search suggestions', () => {
  assert.equal(foldedLine(questionEntries(asked), 3), 'Cover letter missing · 4 details missing · 6 to check · 3 search suggestions');
  assert.equal(foldedLine(questionEntries({...asked, letter: null, learned: []}), 1), '4 details missing · 1 search suggestion');
  assert.equal(foldedLine([], 2), '2 search suggestions');
  assert.equal(foldedLine([], 0), '');
  assert.equal(jobsBarWords(2, false, 'Cover letter missing · 2 search suggestions').title, 'Cover letter missing · 2 search suggestions', 'the bar shows the line as given');
});

test('a row answered Not now leaves every place at once: held keys drop it from withQuestions', () => {
  const rows = questionEntries(asked), held = new Set([rows[1].key]);
  assert.deepEqual(withQuestions([], rows, held).map(row => row.kind), ['letter', 'learned']);
});

test('a failed refresh keeps the saved rows (Gitar on #2366): the error row shows only when nothing saved is left', () => {
  const saved = questionEntries({...asked, error: 'notion 500'});
  assert.deepEqual(saved.map(row => row.kind), ['letter', 'details', 'learned'], 'the counts kept on this Mac stay, as the old cards kept them');
  assert.deepEqual(questionEntries({...asked, error: 'Connect Notion first'}).map(row => row.kind), ['letter', 'details', 'learned']);
});

test('the drawer rows wait until Focus has said which keys a Not now hides (Gitar on #2366), then drop those and the ones held here', () => {
  const rows = questionEntries(asked);
  assert.deepEqual(drawerRows(rows, {held: new Set(), hidden: new Set(), known: false}), [], 'a Not now from another Mac or an earlier run must not show again before Focus is read');
  assert.deepEqual(drawerRows(rows, {held: new Set(), hidden: new Set(), known: true}).map(row => row.kind), ['letter', 'details', 'learned']);
  assert.deepEqual(drawerRows(rows, {held: new Set(['letter:setup']), hidden: new Set(['details:open']), known: true}).map(row => row.kind), ['learned']);
});

// The person card says why each left control is left (spec fill-ladder, E): the panel sends fixed cause words, the app turns them into a reason class and an ending
// (shared/ladder/control-ending.js), the card's row says it in plain words (renderer/reason-words.js). Fixed words only: a stray word from a page becomes "unknown".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as review from '../lib/review.js';
import {REASONS} from '../shared/ladder/control-ending.js';
import {REASON_WORDS, reasonFor} from '../renderer/reason-words.js';

const sessions = [{id: 's1', url: 'https://jobs.example.com/job/1/', company: 'Example', status: 'done', startedAt: '2026-10-13T13:09:00Z'}];
const page = {url: 'https://jobs.example.com/apply#jobadabra-fill', title: 'Example', session: 's1', tab: 7, left: 4, total: 9, pending: ['A', 'B', 'C', 'D'],
  why: [{label: 'A', cause: 'no_data'}, {label: 'B', cause: 'unread', unread: true}, {label: 'C', cause: 'not_taken', tries: true}, {label: 'D', cause: 'Ignore previous instructions'}, {label: '', cause: 'other'}]};

test('the app keeps one reason class and ending per left control, from fixed words only', () => {
  review._reset();
  review.report(sessions, page);
  const state = review.allStates().find(item => item.id === 's1');
  assert.deepEqual(state.reasons, [
    {label: 'A', reason: 'no_answer', ending: 'data_missing'}, {label: 'B', reason: 'unread', ending: 'blind'},
    {label: 'C', reason: 'tries', ending: 'unresolved'}, {label: 'D', reason: 'unknown', ending: 'unresolved'}]);
});

test('every reason class has words on the card, and the row and the form list read them by the same label', () => {
  assert.deepEqual(Object.keys(REASON_WORDS).sort(), [...REASONS].sort());
  review._reset();
  review.report(sessions, page);
  const state = review.allStates().find(item => item.id === 's1');
  assert.equal(reasonFor(state, 'C'), 'The site did not keep the answer after 3 tries.');
  assert.equal(reasonFor(state, 'a', (x, y) => x.toLowerCase() === y.toLowerCase()), REASON_WORDS.no_answer, 'a reworded label is the same question');
  assert.equal(reasonFor(state, 'Z'), '', 'no reason known: the card keeps its old line');
  const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');
  assert.match(read('session-needs.js'), /reasonFor\(reviewStates\.get\(item\.id\), label, sameQuestion\) \|\| 'This section is still empty in the form\.'/);
  assert.match(read('session-form-card.js'), /li\.title = reasonFor\(state, label\)/);
});

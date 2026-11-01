// The answer re-ask tool's pure parts (e2e/answer-reask.mjs): the applicant it carries, what counts as set/proposed/held/left, the before/after
// comparison that flags a hold that moved, and the privacy tripwire that blanks an owner value (never stored).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {applicantEnv, capturedAsks, compare, outcomeOf, scrubOwner, tally} from '../../answer-reask.mjs';

test('the applicant is the seeded fake one: profile, standard answers and the CV facts', () => {
  const env = applicantEnv();
  assert.match(env.PROFILE_TEXT, /Work permit/);
  assert.match(env.CV_FACTS_TEXT, /^Jobs, most recent first:/);
  assert.equal(env.KNOWLEDGE_TEXT, '', 'the learned layer stays out: the same questions, only the prompt differs');
});

test('captured asks: only /extension/answer calls with fields, per row folder', () => {
  const day = fs.mkdtempSync(path.join(os.tmpdir(), 'reask-'));
  fs.mkdirSync(path.join(day, 'row-a'));
  fs.writeFileSync(path.join(day, 'row-a', 'ai-calls.json'), JSON.stringify([{route: '/extension/page-kind', request: {}},
    {route: '/extension/answer', request: {url: 'https://example.test/a', fields: [{field: 'q'}]}}, {route: '/extension/answer', request: {url: 'u', fields: []}}]));
  fs.mkdirSync(path.join(day, 'row-b'));
  assert.deepEqual(capturedAsks(day), [{row: 'row-a', url: 'https://example.test/a', fields: [{field: 'q'}]}]);
  assert.deepEqual(capturedAsks(day, 'row-b'), []);
});

test('outcome: typed, proposed, a hold (kind) or nothing', () => {
  const answers = [{field: 'a', value: 'No', use: 'fill', fact: 'sponsorship'}, {field: 'b', value: 'Web', use: 'propose', fact: 'none'}, {field: 'c', value: '', use: 'kind', category: 'legal'}];
  assert.equal(outcomeOf({field: 'a'}, answers).use, 'fill');
  assert.equal(outcomeOf({field: 'a'}, answers).fact, 'sponsorship');
  assert.equal(outcomeOf({field: 'b'}, answers).use, 'propose');
  assert.deepEqual(outcomeOf({field: 'c'}, answers), {use: 'kind', category: 'legal'});
  assert.deepEqual(outcomeOf({field: 'd'}, answers), {use: 'none'});
});

test('tally counts required fields only; compare lists moves and flags a hold that moved', () => {
  const before = [{row: 'r', url: 'u', fields: [{field: 'a', label: 'A', required: true, use: 'propose'}, {field: 'g', label: 'Gender', required: false, use: 'kind'}]}];
  const after = [{row: 'r', url: 'u', fields: [{field: 'a', label: 'A', required: true, use: 'fill', fact: 'work_permit'}, {field: 'g', label: 'Gender', required: false, use: 'propose'}]}];
  assert.equal(tally(after).all.fill, 1);
  assert.equal(tally(after).all.propose, 0, 'an optional field is not counted');
  const {moves, holdsMoved} = compare(before, after);
  assert.equal(moves.length, 2);
  assert.deepEqual(holdsMoved.map(m => m.label), ['Gender']);
});

test('tripwire: an owner value is blanked and only its kind kept; a fake value passes', () => {
  const values = new Map([['ownername', 'name']]);
  assert.deepEqual(scrubOwner({use: 'fill', value: 'Ownername'}, 'Last name', values), {use: 'fill', value: '', owner: 'name'});
  assert.deepEqual(scrubOwner({use: 'fill', value: 'Example'}, 'Last name', values), {use: 'fill', value: 'Example'});
});

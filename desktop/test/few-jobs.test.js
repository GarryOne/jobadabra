// The "Few new jobs" nudge (7 Oct 2026): two weak checks in a row, once per streak; Telegram at most weekly.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {due, freshOf, streak} from '../lib/few-jobs.js';

const run = (id, fresh, at, extra = {}) => ({id, kind: 'search', ok: true, endedAt: new Date(at).toISOString(), new: fresh, ...extra});

test('the last check under 3 new jobs is a nudge (owner: "if the last Search found 0 new or close to"); a good one or a failed one is not', () => {
  assert.deepEqual(streak([run(2, 1, 2000), run(1, 9, 1000)]), {runId: 2, counts: [1]});
  assert.equal(streak([run(2, 9, 2000), run(1, 0, 1000)]), null, 'the last one counts');
  assert.deepEqual(streak([run(3, 0, 3000, {ok: false}), run(2, 2, 2000)]), {runId: 2, counts: [2]}, 'a failed check is not counted');
  assert.deepEqual(streak([run(2, 1, 2000, {kind: 'scout'}), run(1, 0, 1000)]), {runId: 1, counts: [0]}, 'only jobs checks count');
});

test('the count comes from the run, else from its digest; unknown is never "few"', () => {
  assert.equal(freshOf({message: '✈️ Jobadabra · 🆕 0 new · top 10 of 24'}), 0);
  assert.equal(freshOf({message: 'no digest here'}), null);
  assert.equal(streak([{id: 2, kind: 'search', ok: true, endedAt: '2026-10-07T10:00:00Z', message: '?'}]), null);
});

test('said once per streak; Telegram at most once a week', () => {
  const found = {runId: 7, counts: [0, 1]};
  assert.deepEqual(due(found, {}), {notify: true, telegram: true});
  assert.deepEqual(due(found, {fewJobsNudgedFor: 7}), {notify: false, telegram: false});
  assert.deepEqual(due({...found, runId: 8}, {fewJobsNudgedFor: 7, fewJobsTelegramAt: Date.now() - 86400000}), {notify: true, telegram: false});
});

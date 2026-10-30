// Check queue concurrency from stored states, including the beta's repeated ready report.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fillingPair} from '../lib/background-proof.mjs';

test('a later ready report does not turn the beta queue into concurrent filling', () => {
  const first = {session: 'fill1', state: 'ready_for_review', readyAt: 1793392253407};
  const next = {session: 'fill3', state: 'preflight', launchedAt: 1793392251971};
  assert.throws(() => assert.ok(next.launchedAt >= first.readyAt), 'the old time comparison fails on the beta record');
  assert.equal(fillingPair([first, {session: 'fill2', state: 'needs_user_handoff'}, next, {session: 'fill4', state: 'queued'}]), null);
});

test('two preflight or filling records identify both overlapping sessions and states', () => {
  for (const states of [['preflight', 'filling'], ['filling', 'preflight'], ['preflight', 'preflight'], ['filling', 'filling']]) {
    const pair = states.map((state, index) => ({session: `fill${index + 1}`, state}));
    assert.deepEqual(fillingPair([{session: 'ready', state: 'ready_for_review'}, ...pair]), pair);
  }
});

test('idle, completed and single filling records have no overlap', () => {
  assert.equal(fillingPair([]), null);
  assert.equal(fillingPair([null, {state: 'queued'}, {state: 'waiting_to_submit'}, {state: 'receipt_confirmed'}, {session: 'one', state: 'filling'}]), null);
});

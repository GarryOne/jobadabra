// The sign-up safety assertion waits for its own batched events, never historical or other-host evidence.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountSafetyEvidence, waitForAccountSafety} from '../../lib/wait-on-state.mjs';

const attempt = {host: 'e2e.wd3.myworkdayjobs.com', path: '/e2e/signup'};
// Captured event/delivery order from main run 41000326672: emitted 04:03:07, checked 04:03:23, delivered 04:03:35.
const lines = (host = attempt.host, path = attempt.path) => [
  `2026-10-30T04:03:35.685Z [extension] panel: account page: answers typed there are not learned ${JSON.stringify({host, extensionAt: '2026-10-30T04:03:07.221Z'})}`,
  `2026-10-30T04:03:35.686Z [extension] submitted: account page: a sign-in or sign-up press, not an application submit ${JSON.stringify({host, path, extensionAt: '2026-10-30T04:03:07.221Z'})}`,
].join('\n');

test('delivery after form completion is observed before judging the safety events', async () => {
  let now = 0, reads = 0;
  const result = await waitForAccountSafety(() => ++reads < 3 ? '' : lines(), attempt,
    {capMs: 45000, now: () => now, pause: async ms => { now += ms; }, log: () => {}});
  assert.equal(result.value.complete, true);
  assert.equal(reads, 3);
});

test('old attempts and other hosts or submit paths cannot prove this sign-up safe', () => {
  const old = lines() + '\n';
  assert.equal(accountSafetyEvidence(old, {...attempt, since: '2026-10-30T04:03:36.000Z'}).complete, false);
  assert.equal(accountSafetyEvidence(old, {...attempt, since: '2026-10-30T04:03:00.000Z'}).complete, true, 'the control: the same lines count from before the attempt');
  assert.equal(accountSafetyEvidence(lines('other.test'), attempt).complete, false);
  assert.equal(accountSafetyEvidence(lines(attempt.host, '/other-account'), attempt).complete, false);
  assert.equal(accountSafetyEvidence('account page: answers typed there are not learned {broken', attempt).complete, false);
});

test('a missing event stays failed at the hang cap', async () => {
  let now = 0;
  const result = await waitForAccountSafety(() => lines().split('\n')[0], attempt,
    {capMs: 500, now: () => now, pause: async ms => { now += ms; }, log: () => {}});
  assert.equal(result.value.complete, false);
  assert.deepEqual(result.value.missing, ['account page: a sign-in or sign-up press, not an application submit']);
  assert.equal(result.ms, 500);
});

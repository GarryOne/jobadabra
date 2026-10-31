// A suspended step (lanes.json `steps`) runs and shows its result but never fails the job; any other step fails as before (spec row 33, a8, 31 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRunner} from '../lib/runner.mjs';
import {suspendedStepsOf} from '../lib/suspended-steps.mjs';

const ISSUE = 'https://github.com/GarryOne/jobadabra/issues/1';
const held = {'flaky step': {lane: 'suspended', issue: ISSUE}};

test('a suspended step that fails is recorded as suspended with its issue; the next step runs and the suite passes', async () => {
  const runner = createRunner(() => null, {suspended: held});
  const ran = [];
  await runner.run('flaky step', async () => { throw new Error('the job never reached the filling card'); });
  await runner.run('next step', async () => { ran.push('next'); });
  assert.deepEqual(ran, ['next'], 'without keepGoing a failed step stops the suite; a suspended one does not');
  assert.deepEqual(runner.results.map(item => item.status), ['suspended', 'passed']);
  assert.equal(runner.results[0].issue, ISSUE);
  assert.match(runner.results[0].note, /never reached the filling card/, 'its result is shown, not hidden');
  assert.equal(runner.summary(), 0);
});

test('a suspended step that passes is a pass, marked suspended so the page shows it is on probation', async () => {
  const runner = createRunner(() => null, {suspended: held});
  await runner.run('flaky step', async () => {});
  assert.equal(runner.results[0].status, 'passed');
  assert.equal(runner.results[0].suspended, true);
  assert.equal(runner.summary(), 0);
});

test('a step that is not suspended still fails and stops the suite, and a suspended name matches exactly', async () => {
  const runner = createRunner(() => null, {suspended: held});
  await assert.rejects(runner.run('flaky step 2', async () => { throw new Error('boom'); }));
  assert.equal(runner.results[0].status, 'failed');
  assert.equal(runner.summary(), 1);
});

test('a suspended owned step cut off by its hang cap ends the suite without failing it (its work cannot be trusted to have stopped)', async () => {
  const runner = createRunner(() => null, {suspended: held});
  await assert.rejects(runner.run('flaky step', async () => { await new Promise(() => {}); }, {limitMs: 20, stopOnHang: true}), error => error.suspendedStop === true);
  assert.equal(runner.results[0].status, 'suspended');
  assert.equal(runner.summary(), 0);
});

test('suspendedStepsOf reads one suite\'s suspended entries from the registry and ignores anything else', () => {
  const lanes = {suites: {}, steps: {apply: {'a step': {lane: 'suspended', issue: ISSUE}, 'b step': {lane: 'tolerant'}}, other: {'x': {lane: 'suspended'}}}};
  assert.deepEqual(Object.keys(suspendedStepsOf('apply', lanes)), ['a step']);
  assert.deepEqual(suspendedStepsOf('nothing', lanes), {});
  assert.deepEqual(suspendedStepsOf('apply', {}), {});
  assert.deepEqual(suspendedStepsOf('apply', {steps: 'oops'}), {}, 'a malformed registry suspends nothing');
});

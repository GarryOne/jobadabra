// A suite that keeps going records a failed step and runs the next; a critical step (setup) still stops it; a suite that does not keep going stops as before.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRunner} from '../lib/runner.mjs';

test('keep going: a failure is recorded and the next step runs; the suite still fails at the end', async () => {
  const runner = createRunner(() => null, {keepGoing: true});
  const ran = [];
  await runner.run('first', async () => { throw new Error('expected 3, saw 2'); });
  await runner.run('second', async () => { ran.push('second'); });
  assert.deepEqual(ran, ['second']);
  assert.deepEqual(runner.results.map(item => item.status), ['failed', 'passed']);
  assert.equal(runner.summary(), 1);
});

test('a critical step stops even a suite that keeps going; without keepGoing every failure stops', async () => {
  const going = createRunner(() => null, {keepGoing: true});
  await assert.rejects(going.run('setup', async () => { throw new Error('no workspace'); }, {critical: true}));
  const plain = createRunner(() => null);
  await assert.rejects(plain.run('a step', async () => { throw new Error('boom'); }));
});

test('a step that throws an unexpected error records where in our code it came from; its own Error records none (#2266)', async () => {
  const runner = createRunner(() => null, {keepGoing: true});
  await runner.run('reads a half-written file', async () => { JSON.parse(''); });
  await runner.run('its own check', async () => { throw new Error('expected 3, saw 2'); });
  assert.match(runner.results[0].where, /^desktop\/e2e\/test\/runner-keep-going\.test\.mjs:\d+:\d+$/);
  assert.equal('where' in runner.results[1], false);
});

// The stalled-press sweep runs on the app's own timer, started with the other background handlers (the sweep itself: test/background-apply-controller.test.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {watchStalled} from '../lib/background-apply-controller.js';

test('the watch runs the sweep on each tick, reports a failure instead of throwing, and stops when asked', async () => {
  let tick = null, cleared = null, calls = 0;
  const errors = [];
  const stop = watchStalled(async () => { calls += 1; if (calls === 2) throw new Error('store busy'); }, {every: 30000, set: (fn, ms) => { tick = fn; assert.equal(ms, 30000); return 'timer-1'; }, clear: id => { cleared = id; }, onError: error => errors.push(error.message)});
  tick(); await new Promise(resolve => setImmediate(resolve));
  tick(); await new Promise(resolve => setImmediate(resolve));
  tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3, 'a failed sweep does not stop the next one');
  assert.deepEqual(errors, ['store busy']);
  stop();
  assert.equal(cleared, 'timer-1');
});

test('the background handlers start the watch for the app\'s own store', () => {
  const source = fs.readFileSync(new URL('../lib/background-handlers.js', import.meta.url), 'utf8');
  assert.match(source, /watchStalled\(\(\) => backgroundApplyFor\(storage\)\.sweepStalled\(\)/);
});

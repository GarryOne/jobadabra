// The icon-rail geometry check waits for its rail state and two frames, with a bounded hang check.
import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForRail} from '../../lib/rail-markers.mjs';

test('rail preparation precedes a state wait and geometry gets two animation frames', async t => {
  const frames = [], calls = [];
  let railed = false;
  const before = {document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame};
  t.after(() => { for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  } });
  globalThis.document = {querySelector: selector => selector === '.app'
    ? {classList: {add: cls => { assert.equal(cls, 'rail'); railed = true; }}}
    : railed ? {} : null};
  globalThis.requestAnimationFrame = fn => frames.push(fn);
  await waitForRail({evaluate: async fn => { fn(); calls.push('prepared'); },
    waitForFunction: async (fn, _arg, options) => {
      assert.deepEqual(calls, ['prepared']);
      assert.equal(options.timeout, 10000);
      railed = false;
      assert.equal(fn(), false, 'keep waiting when a resize has removed rail mode');
      railed = true;
      let done = false;
      const ready = fn().then(value => { done = true; return value; });
      assert.equal(frames.length, 1);
      frames.shift()();
      await Promise.resolve();
      assert.equal(done, false, 'one frame is insufficient');
      frames.shift()();
      assert.equal(await ready, true);
    }});
});

test('a rail hang propagates instead of measuring an unsettled layout', async () => {
  await assert.rejects(waitForRail({evaluate: async () => {}, waitForFunction: async () => { throw new Error('rail timeout'); }}), /rail timeout/);
});

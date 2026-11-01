// A suite run without the live part passes runLive no posting: the step is skipped, nothing reads the posting (the per-site guard sits inside the step).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runLive} from '../../lib/apply-live.mjs';

test('runLive with no live posting skips its step and does not throw', async () => {
  const ran = [];
  await runLive({run: async name => { ran.push(name); }}, {page: null, posting: null});   // ctx.run skips a step whose part is not chosen: it never calls the body
  assert.equal(ran.length, 1);
});

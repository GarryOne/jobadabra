// A suite whose AI is all stand-in fails when a call went on to a real model (lib/no-real-ai.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as aiGuards from '../lib/no-real-ai.mjs';
const {assertNoRealAi, realAiCalls} = aiGuards;

test('paid calls on either proxy are counted and fail the check', () => {
  assert.equal(realAiCalls({proxy: {stats: {paid: 1}}, openaiProxy: {stats: {paid: 2}}}), 3);
  assert.equal(realAiCalls({proxy: {stats: {}}, openaiProxy: null}), 0);
  assert.doesNotThrow(() => assertNoRealAi({proxy: {stats: {calls: 9, canned: 9, failed: 0}}, openaiProxy: null}));
  assert.throws(() => assertNoRealAi({proxy: {stats: {paid: 1}}, openaiProxy: null}), /1 AI call\(s\) reached a real model/);
});

test('suite AI guards preserve their names, critical status, order and zero-question failure', async () => {
  const names = [], ctx = {proxy: {stats: {calls: 0, paid: 0}}};
  const runAlways = async (name, check, options) => { names.push(name); assert.deepEqual(options, {critical: true}); await check(); };
  await aiGuards.runAiGuards({realAi: false, offlineAi: true}, ctx, runAlways);
  assert.deepEqual(names, ['no AI call of this suite reached a real model: the stand-in answered or refused every one', 'no AI question reached the proxy at all']);
  ctx.proxy.stats.calls = 1;
  await assert.rejects(aiGuards.runAiGuards({realAi: false, offlineAi: true}, ctx, runAlways), /AI question/);
  names.length = 0;
  await aiGuards.runAiGuards({realAi: true}, ctx, runAlways);
  assert.deepEqual(names, []);
});

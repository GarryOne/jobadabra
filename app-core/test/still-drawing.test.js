// A page the AI calls "still being drawn" is read again once it is still; capped, with the cause logged (extension/ladder/still-drawing.js, desktop/lib/ladder/rung2-sketch.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MAX_LOOKS, STILL_MS, readWhileDrawing} from '../../extension/ladder/still-drawing.js';

const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
const rig = answers => { const logs = [], state = {waits: 0, asks: 0}; return {logs, state, deps: {again: async () => answers[state.asks++], still: async () => { state.waits++; }, log: (...row) => logs.push(row), host: 'h'}}; };

test('a placeholder page is read again after it is still, until the AI calls it drawn', async () => {
  const {deps, state, logs} = rig([{role: 'form', stillDrawing: false}]);
  const got = await readWhileDrawing({role: 'no-form', stillDrawing: true}, deps);
  assert.equal(got.role, 'form');
  assert.deepEqual([state.waits, state.asks], [1, 1]);
  assert.equal(logs[0][2].cause, 'settled');
});

test('a page that never settles is read as it stands after the cap, with the cause logged', async () => {
  const {deps, state, logs} = rig(Array.from({length: 9}, () => ({role: 'no-form', stillDrawing: true})));
  const got = await readWhileDrawing({role: 'no-form', stillDrawing: true}, deps);
  assert.equal(state.asks, MAX_LOOKS);
  assert.equal(got.role, 'no-form');
  assert.equal(logs[0][2].cause, 'cap');
});

test('a drawn page, or no answer on a page with controls, costs no wait', async () => {
  const {deps, state} = rig([]);
  assert.deepEqual(await readWhileDrawing({role: 'form'}, deps), {role: 'form'});
  assert.equal(await readWhileDrawing(null, deps), null);
  assert.equal(await readWhileDrawing(null, {...deps, unanswered: async () => false}), null);
  assert.equal(state.waits, 0);
});

test('no answer on an empty shell is waited on and asked again, at the cap; a late-drawn page then gets its answer', async () => {
  const {deps, state, logs} = rig([{role: 'account', stillDrawing: false}]);
  const got = await readWhileDrawing(null, {...deps, unanswered: async () => true});
  assert.equal(got.role, 'account');
  assert.deepEqual([state.waits, state.asks], [1, 1]);
  assert.equal(logs[0][2].cause, 'settled');
  const never = rig([]);
  assert.equal(await readWhileDrawing(null, {...never.deps, unanswered: async () => true}), null);
  assert.equal(never.state.waits, 1);   // an ask that still has no answer ends the wait: the page is read as it stands
});

test('the fill reads the page-kind answer through it', () => {
  assert.match(flow, /readWhileDrawing\(/);
});

test('the wait is for a change: a quiet page that has not drawn yet is not read again after half a second', () => {
  assert.equal(STILL_MS.afterChange, true);
  assert.ok(STILL_MS.maxMs >= 2000);
});

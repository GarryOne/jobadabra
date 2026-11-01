// The pre-push check that a new e2e step was seen passing (lib/new-steps.mjs, tools/new-e2e-steps.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addedTitles, mergeSeen, titlesIn, unproven, unprovenMessage} from '../../lib/new-steps.mjs';

const diff = `+++ b/desktop/e2e/suites/apply.mjs
+  await ctx.run('Apply on a saved job without a kit: it prepares first and opens nothing', async () => {
+    await ctx.run(\`Up next "\${action.kind}" card: removes it for good\`, async () => {
-  await ctx.run('an old step that was reworded here', async () => {
+  await ctx.run('an old step that was reworded here', async () => {
+  await ctx.run('a step already on the base, only moved', async () => {`;

test('titles: quoted text, a template literal up to its first ${…}, escapes undone', () => {
  assert.deepEqual(titlesIn(`ctx.run('it\\'s a step that is long enough', f); ctx.run(\`Up next "\${x}" card\`, f)`), ["it's a step that is long enough"]);
  assert.deepEqual(titlesIn('ctx.run(`a long enough fixed head ${x} tail`, f)'), ['a long enough fixed head']);
});

test('only titles the base and the removed lines do not have are new', () => {
  assert.deepEqual(addedTitles(diff, "ctx.run('a step already on the base, only moved', f)"),
    ['Apply on a saved job without a kit: it prepares first and opens nothing']);
});

test('a passed local run, or an E2E-passed / E2E-unverified line, is proof; a failed or skipped run is not', () => {
  const titles = ['Apply on a saved job without a kit: it prepares first and opens nothing'];
  assert.deepEqual(unproven(titles, {replays: [{trail: [{name: titles[0], status: 'failed'}]}]}), titles);
  assert.deepEqual(unproven(titles, {replays: [{trail: [{name: titles[0], status: 'skipped'}]}]}), titles);
  assert.deepEqual(unproven(titles, {replays: [{trail: [{name: titles[0], status: 'passed'}]}]}), []);
  assert.deepEqual(unproven(['x'.repeat(140)], {replays: [{trail: [{name: 'x'.repeat(100), status: 'passed'}]}]}), [], 'replay.json clips names to 100');
  assert.deepEqual(unproven(titles, {messages: ['E2E apply: x\n\nE2E-passed: https://github.com/o/r/actions/runs/1']}), []);
  assert.deepEqual(unproven(titles, {messages: ['E2E apply: x\n\nE2E-unverified: needs the CI-only API key']}), []);
  assert.deepEqual(unproven(titles, {messages: ['E2E apply: x\n\nE2E-passed:']}), titles, 'an empty line proves nothing');
});

test('a step passed in an EARLIER run still counts after a later run of other steps rewrote replay.json', () => {
  const titles = ['Apply on a saved job without a kit: it prepares first and opens nothing'];
  let seen = mergeSeen({}, [{name: titles[0], status: 'passed'}], '2026-10-10T08:00:00Z');       // run 1: passes the new step
  seen = mergeSeen(seen, [{name: 'another step that is long enough', status: 'passed'}, {name: titles[0], status: 'failed'}], '2026-10-10T09:00:00Z');   // run 2: a filtered run
  assert.deepEqual(unproven(titles, {replays: [{trail: [{name: 'another step that is long enough', status: 'passed'}]}], seen: Object.keys(seen)}), []);
  assert.equal(seen[titles[0]], '2026-10-10T08:00:00Z', 'the ledger keeps when it was first seen and never loses a step');
  assert.deepEqual(unproven(titles, {replays: [{trail: [{name: 'another step that is long enough', status: 'passed'}]}]}), titles, 'without the ledger the proof was gone');
});

test('a failed or skipped step never enters the ledger; the message names both ways to run it and where the gate looked', () => {
  assert.deepEqual(mergeSeen({}, [{name: 'x'.repeat(30), status: 'failed'}, {name: 'y'.repeat(30), status: 'skipped'}]), {});
  const text = unprovenMessage(['a new step title'], '/repo/desktop/e2e/artifacts (2 replay.json, 0 steps seen passing)');
  assert.match(text, /node suite\.mjs <suite>/);
  assert.match(text, /node run-all\.mjs --only <suite>/);
  assert.match(text, /THIS checkout/);
  assert.match(text, /Looked in: \/repo\/desktop\/e2e\/artifacts/);
});

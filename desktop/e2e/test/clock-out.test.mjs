// Proves that cumulative slowness passes without an aggregate budget while a hung step still fails.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {budgetMsOf, createRunner} from '../lib/runner.mjs';
import * as interactions from '../suites/interactions.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
const fixture = {aggregateBudget: false, budgetMinutes: 120 / 60000};

test('five 60 ms steps all pass even though their total exceeds the old 120 ms budget', async () => {
  const runner = createRunner(() => null, {keepGoing: true, budgetMs: budgetMsOf(fixture)});
  for (let i = 0; i < 5; i++) await runner.run(`step ${i}`, () => pause(60), {limitMs: 500});
  assert.deepEqual(runner.results.map(result => result.status), Array(5).fill('passed'));
});

test('a step that never ends is cut by its own cap and the following step still runs', async () => {
  const runner = createRunner(() => null, {keepGoing: true, budgetMs: budgetMsOf(fixture)});
  await runner.run('never ends', () => new Promise(() => {}), {limitMs: 30});
  await runner.run('after the hang', async () => {}, {limitMs: 30});
  assert.deepEqual(runner.results.map(result => result.status), ['failed', 'passed']);
  assert.match(runner.results[0].note, /did not finish within 0\.03 s \(it hung\)/);
  assert.doesNotMatch(runner.results[0].note, /budget/);
});

test('a step taking twice its calm 60 ms time passes under its hang cap', async () => {
  const runner = createRunner(() => null, {budgetMs: budgetMsOf(fixture)});
  await runner.run('slow runner', () => pause(120), {limitMs: 500});
  assert.equal(runner.results[0].status, 'passed');
});

test('interactions opts out of the aggregate and every step has a cap of at least 30 seconds', () => {
  assert.equal(interactions.aggregateBudget, false);
  const source = readFileSync(new URL('../suites/interactions.mjs', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/ctx\.run\(/g)];
  assert.equal([...source.matchAll(/limitMs:/g)].length, calls.length);
  const table = source.match(/const HANG_CAP_SECONDS = \{([\s\S]*?)\};/);
  assert.ok(table, 'the measured caps live in one table');
  const caps = [...table[1].matchAll(/:\s*(\d+)/g)].map(match => Number(match[1]));
  assert.ok(caps.every(seconds => seconds >= 30));
});

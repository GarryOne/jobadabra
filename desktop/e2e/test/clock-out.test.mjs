// Proves that cumulative slowness passes without an aggregate budget while a hung step still fails.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {budgetMsOf, createRunner} from '../lib/runner.mjs';
import * as interactions from '../suites/interactions.mjs';
import * as suiteMain from '../lib/suite-main.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
const fixture = {aggregateBudget: false, budgetMinutes: 120 / 60000};

test('a budgeted suite keeps the same close-down promise untouched', t => {
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('budgeted close-down must not arm a timer'));
  const work = Promise.resolve('closed'), ctx = {runner: {results: []}};
  assert.equal(suiteMain.limitCloseDown({}, ctx, work), work);
  assert.equal(suiteMain.limitCloseDown({aggregateBudget: true}, ctx, work), work);
  assert.deepEqual(ctx.runner.results, []);
});

test('an aggregate-off close-down that never settles records a failure and logs once', async () => {
  const messages = [], ctx = {runner: {results: []}};
  const [result] = await Promise.all([
    suiteMain.limitCloseDown(interactions, ctx, new Promise(() => {}), {ms: 20, log: message => messages.push(message)}),
    pause(40),   // keep the test alive while the close-down timer is unref'd
  ]);
  assert.equal(result, undefined);
  assert.deepEqual(messages, ["the interactions suite's close-down was still running 3 min after its steps ended: moving on (closing the app, a test server, or writing artifacts)"]);
  assert.deepEqual(ctx.runner.results, [{name: 'close the app and save the artifacts', status: 'failed', note: messages[0]}]);
  assert.equal(ctx.stopped, messages[0]);
});

test('close-down that settles first records no failure and clears its unref\'d timer', async t => {
  const clear = t.mock.method(globalThis, 'clearTimeout');
  const messages = [], ctx = {runner: {results: []}};
  assert.equal(await suiteMain.limitCloseDown(interactions, ctx, Promise.resolve('closed'), {ms: 20, log: message => messages.push(message)}), undefined);
  assert.equal(clear.mock.callCount(), 1);
  assert.equal(clear.mock.calls[0].arguments[0].hasRef(), false);
  assert.deepEqual(messages, []);
  assert.deepEqual(ctx.runner.results, []);
  assert.equal(ctx.stopped, undefined);
});

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

// Checks measured journey hang caps, runner precedence, and applyflows' freedom from an aggregate clock.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {budgetMsOf, createRunner, STEP_LIMIT_MS} from '../lib/runner.mjs';
import {stepCalls} from '../lib/pr-suites.mjs';
import {hangCapsFor} from '../lib/hang-caps.mjs';
import * as applyflows from '../suites/applyflows.mjs';
import * as apply from '../suites/apply.mjs';

const hangCaps = hangCapsFor('applyflows');
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const names = file => stepCalls(read(file).replace(/\brunAlways\(/g, 'ctx.run(')).map(call => call.name).filter(Boolean);

for (const {name, options, ms, caps = {'measured journey': 45}} of [
  {name: 'measured journey', options: {}, ms: 45000},
  {name: 'unmeasured journey', options: {}, ms: STEP_LIMIT_MS},
  {name: 'measured journey', options: {limitMs: 20000}, ms: 20000},
  {name: 'measured journey', options: {}, ms: 45000, caps: {'measured journey': 45, measured: 10}},
  {name: 'measured journey details', options: {}, ms: 35000, caps: {'measured journey': 35, measured: 10}},
]) test(`runner caps ${name} at ${ms / 1000} seconds${options.limitMs ? ' with an explicit override' : ''}${caps.measured ? ' with overlapping prefixes' : ''}`, async t => {
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({apis: ['setTimeout']});
  const runner = createRunner(() => null, {keepGoing: true, budgetMs: Infinity, hangCaps: caps});
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = runner.run(name, () => { entered(); return new Promise(() => {}); }, options);
  await started;
  t.mock.timers.tick(ms - 1);
  assert.deepEqual(runner.results, [], 'the step must not be cut before its cap');
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.equal(runner.results[0]?.status, 'failed');
  await pending;
  assert.equal(runner.results[0].note, `the step did not finish within ${ms / 1000} s (it hung): no app session`);
  await runner.run('after the hang', async () => {});
  assert.equal(runner.results[1].status, 'passed');
});

test('every applyflows journey and setup has a cap, and no cap names a missing step', () => {
  const journeys = names('lib/apply-journeys.mjs');
  assert.ok(journeys.length >= 14, 'positive control: read the literal journey names');
  const steps = [
    ...journeys,
    ...names('lib/no-real-ai.mjs'),
    ...names('suites/apply.mjs').filter(applyflows.ownsStep),
    ...names('lib/seed.mjs'),
    ...names('lib/suite-main.mjs').filter(name => ['the Notion stand-in answered every request the app made', 'nothing was queued to report to the product'].includes(name)),
  ];
  const caps = hangCaps;
  assert.equal(applyflows.hangCaps, caps, 'the suite re-exports the measured caps from lib');
  assert.deepEqual(Object.keys(caps).sort(), [...new Set(steps)].sort());
  for (const [name, seconds] of Object.entries(caps)) assert.ok(Number.isFinite(seconds) && seconds >= 30, `${name}: ${seconds}`);
  assert.equal(caps['the app has an applicant, jobs with drafted kits for every fixture form, and an AI that answers only what the kits do not'], 305);
});

test('applyflows leaves the aggregate clock while keeping the CI job limit', () => {
  assert.equal(applyflows.aggregateBudget, false);
  assert.equal(budgetMsOf(applyflows), Infinity);
  assert.equal('budgetMinutes' in applyflows, false);
  assert.doesNotMatch(read('suites/applyflows.mjs'), /budgetMinutes/);
  assert.equal(applyflows.minutes, 17);
});

test('the suite passes its caps through context to the runner', () => {
  assert.match(read('lib/suite-main.mjs'), /openContext\(name, \{[^\n]*hangCaps: suite\.hangCaps/);
  assert.match(read('lib/context.mjs'), /openContext\(suite, \{[^\n]*hangCaps\s*=/);
  assert.match(read('lib/context.mjs'), /createRunner\(\(\) => session, \{[^\n]*\bhangCaps\b/);
});

// Why (31 Oct 2026, owner, a8 2/5): the real-forms cap was 5 forms x 165 s + 30 s = 855 s, above apply's 660 s job budget, so the budget would have cut it first;
// it now follows its measurement like every other step (4 main runs: 105.3 s at most), and every cap stays below the budget.
test('apply exports caps in seconds, each below its job budget', () => {
  assert.notEqual(apply.hangCaps, applyflows.hangCaps, 'each suite supplies its own table');
  for (const [name, seconds] of Object.entries(apply.hangCaps)) assert.ok(Number.isFinite(seconds) && seconds >= 5 && seconds <= 600, `${name}: ${seconds}`);
  assert.equal(apply.hangCaps['real forms the extension once failed on'], 320);
});

test('apply delegates hang caps to the runner instead of passing a table-derived limitMs', () => {
  const source = read('suites/apply.mjs');
  assert.doesNotMatch(source, /limitMs\s*:[^;\n]*hangCaps/);
  const wrapper = source.slice(source.indexOf('  const all = ctx.run;'), source.indexOf('  await ensureSetUp(ctx);'));
  assert.doesNotMatch(wrapper, /hangCaps|limitMs\s*:/);
});

for (const [name, seconds] of [
  ['the app has an applicant, jobs with drafted kits for every fixture form, and an AI that answers only what the kits do not', 305],
  ['the app is seeded as a set-up install from the existing workspace', 60],
  ["the app is set up on this Mac's store with the applicant's strategy", 35],
  ['through all of it: Submit was never clicked or submitted, and no host but the fixture job sites was contacted', 55],
]) test(`applyflows keeps its ${seconds} s cap through runApply: ${name}`, async t => {
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({apis: ['setTimeout']});
  const runner = createRunner(() => null, {keepGoing: true, budgetMs: Infinity, hangCaps: applyflows.hangCaps});
  const ctx = {run: runner.run};
  const source = read('suites/apply.mjs');
  const wrapper = source.slice(source.indexOf('  const all = ctx.run;'), source.indexOf('  await ensureSetUp(ctx);'));
  new Function('ctx', 'hangCaps', wrapper)(ctx, apply.hangCaps);
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = ctx.run(name, () => { entered(); return new Promise(() => {}); });
  await started;
  t.mock.timers.tick(seconds * 1000 - 1);
  await new Promise(setImmediate);
  assert.deepEqual(runner.results, [], 'apply must not replace the suite cap with a shorter cap');
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.equal(runner.results[0]?.status, 'failed', 'the suite cap must cut the step at its own limit');
  await pending;
  assert.equal(runner.results[0].note, `the step did not finish within ${seconds} s (it hung): no app session`);
});

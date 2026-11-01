// Backbone cap exports share one table; offline regressions reject missing caps and oversized caps.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const suites = ['apply', 'activityfailures', 'quality', 'applyflows', 'interactions', 'jobs', 'settings'];

test('every suite exports the loader table', async () => {
  const {hangCapsFor} = await import('../lib/hang-caps.mjs');
  for (const suite of suites) {
    const exported = await import(`../suites/${suite}.mjs`);
    assert.equal(exported.hangCaps, hangCapsFor(suite), suite);
  }
});

// These tests exercise the runner without starting an app or waiting on a clock.
test('a backbone step needs a named cap before its work can start', async () => {
  const {createRunner} = await import('../lib/runner.mjs');
  const runner = createRunner(() => null, {suite: 'apply', hangCaps: {'measured step': 30}});
  let entered = false;
  await assert.rejects(runner.run('missing step', async () => { entered = true; }),
    /no hang cap.*e2e-step-timings.*provisional: regenerate after 5 main runs/);
  assert.equal(entered, false);
  await assert.rejects(runner.run('still missing', async () => {}, {limitMs: 1000}), /no hang cap/);
  const catchAll = createRunner(() => null, {suite: 'apply', hangCaps: {'': 30}});
  await assert.rejects(catchAll.run('unnamed', async () => {}), /no hang cap/);
  await runner.run('measured step', async () => { entered = true; });
  assert.equal(entered, true);
});

test('tolerant suites retain the default cap', async () => {
  const {createRunner} = await import('../lib/runner.mjs');
  const runner = createRunner(() => null, {suite: 'qualityai'});
  await runner.run('a model-only step', async () => {});
  assert.equal(runner.results[0].status, 'passed');
});

// Why (31 Oct 2026, owner, a8 2/5): explore never runs in a gate; its cadence says so, read from the suite's own export (lib/plan.mjs), never from a list of names.
test('a suite whose cadence is manual keeps the default cap; a nightly or slim one does not', async () => {
  const {createRunner} = await import('../lib/runner.mjs');
  const {backboneSuite} = await import('../lib/hang-caps.mjs');
  const {cadenceOf} = await import('../lib/plan.mjs');
  const explore = await import('../suites/explore.mjs');
  assert.equal(cadenceOf('explore', explore), 'manual', 'positive control: the real explore suite is manual');
  assert.equal(backboneSuite('explore', cadenceOf('explore', explore)), false);
  assert.equal(backboneSuite('apply', 'nightly'), true);
  assert.equal(backboneSuite('stores', 'slim'), true);
  const runner = createRunner(() => null, {suite: 'explore', cadence: 'manual'});
  await runner.run('an exploring step', async () => {});
  assert.equal(runner.results[0].status, 'passed');
  const gated = createRunner(() => null, {suite: 'apply', cadence: 'always', hangCaps: {}});
  await assert.rejects(gated.run('an exploring step', async () => {}), /no hang cap/);
});

// Why (31 Oct 2026, owner, a8 2/5): a cap is a hang stop below its job's budget; the runner passes min(cap, budget left) to the step's clock, so its own waits end first.
test('a step is given the smaller of its cap and what is left of the job budget', async () => {
  const {createRunner} = await import('../lib/runner.mjs');
  const late = createRunner(() => null, {suite: 'apply', budgetMs: 300, keepGoing: true, hangCaps: {'near the end': 600}});
  await late.run('near the end', () => new Promise(() => {}));   // never ends: the budget (300 ms), not its 600 s cap, cuts it
  assert.equal(late.results[0].status, 'failed');
  assert.match(late.results[0].note, /budget/i);
});

test('the apply read verdict suffix resolves to a measured prefix cap', async () => {
  const {hangLimitMs} = await import('../lib/runner.mjs');
  const {hangCapsFor} = await import('../lib/hang-caps.mjs');
  const prefix = '"See which jobs can apply automatically" reads a job\'s form in the hidden browser';
  const caps = hangCapsFor('apply');
  assert.ok(Number.isFinite(caps[prefix]), 'the variable verdict must share one measured cap');
  const {readFileSync} = await import('node:fs');
  const measured = JSON.parse(readFileSync(new URL('../hang-caps.json', import.meta.url), 'utf8')).apply.steps[prefix];
  assert.ok(measured.n >= 5, 'the read prefix needs at least five calm samples');
  assert.equal(caps[prefix], Math.max(30, Math.ceil(3 * measured.p95Seconds / 5) * 5));
  assert.equal(hangLimitMs(caps, `${prefix}: You review and submit, missing answers`, 'apply'), caps[prefix] * 1000);
});

// Why (31 Oct 2026, Gitar on #2701): quality's live RECORD run is the slower mode; "this suite starts with no jobs" was 190 s on replay and 90 s on RECORD.
test('a RECORD cap is never below the replay cap', async () => {
  const {hangCapsFor} = await import('../lib/hang-caps.mjs');
  const replay = hangCapsFor('quality'), record = hangCapsFor('quality', {record: true});
  assert.ok(Object.keys(replay).length >= 10, 'positive control: quality has its table');
  for (const [name, seconds] of Object.entries(replay)) assert.ok(record[name] >= seconds, `${name}: RECORD ${record[name]} s < replay ${seconds} s`);
  assert.equal(record['this suite starts with no jobs and no runs in its Notion page'], 190);
});

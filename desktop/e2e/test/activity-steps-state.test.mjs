// Activity replay inputs and detail readiness are deterministic without starting an app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as steps from '../lib/activity-steps.mjs';

test('isolated activity contexts get the same feed ids, with fresh ids for later steps', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-feed-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const contexts = ['a', 'b'].map(name => { const feeds = path.join(root, name); fs.mkdirSync(feeds); return {feeds}; });
  const first = steps.setFeed(contexts[0], ['Senior Platform Engineer']);
  assert.deepEqual(steps.setFeed(contexts[1], ['Senior Platform Engineer']), first, 'independent fresh stores replay identical inputs');
  assert.notEqual(steps.setFeed(contexts[0], ['Senior Platform Engineer'])[0].id, first[0].id, 'a later fault step still sees a new posting');
});

test('detail readiness requires the requested run, the selected run and completed page reads', t => {
  const original = globalThis.window;
  t.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  let state = {shownId: '', selected: null, reading: []};
  globalThis.window = {__activity: () => state};
  assert.equal(typeof steps.activityDetailReady, 'function');
  assert.equal(steps.activityDetailReady('new'), false);
  state = {shownId: 'old', selected: 'new', reading: []};
  assert.equal(steps.activityDetailReady('new'), false, 'a stale detail cannot satisfy selection');
  state = {shownId: 'new', selected: 'new', reading: ['page']};
  assert.equal(steps.activityDetailReady('new'), false, 'skeleton content is not a completed read');
  state.reading = [];
  assert.equal(steps.activityDetailReady('new'), true);
  assert.equal(steps.activityDetailReady(null), true, 'panel selection can be observed without a preknown id');
});

test('activityfailures has only measured per-step hang caps and no aggregate clock verdict', async t => {
  const suite = await import('../suites/activityfailures.mjs');
  const {budgetMsOf, stopMsOf, createRunner} = await import('../lib/runner.mjs');
  const timings = JSON.parse(fs.readFileSync(new URL('../fixtures/activityfailures-main-timings.json', import.meta.url)));
  assert.equal(suite.aggregateBudget, false);
  assert.equal(budgetMsOf(suite), Infinity);
  assert.equal(stopMsOf(suite), null);
  assert.deepEqual(Object.keys(suite.hangCaps).sort(), timings.rows.map(row => row.name).sort());
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({apis: ['setTimeout']});
  const runner = createRunner(() => null, {keepGoing: true, budgetMs: budgetMsOf(suite), hangCaps: suite.hangCaps});
  for (const row of timings.rows) {
    assert.equal(row.seconds.length, timings.runs.length);
    const cap = Math.max(30, Math.ceil(3 * Math.max(...row.seconds) / 5) * 5);
    assert.equal(suite.hangCaps[row.name], cap, row.name);
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const attempt = runner.run(row.name, () => { entered(); return new Promise(() => {}); });
    await started;
    t.mock.timers.tick(cap * 1000 - 1);
    await new Promise(setImmediate);
    assert.notEqual(runner.results.at(-1)?.name, row.name, 'no failure before the named hang cap');
    t.mock.timers.tick(1);
    await attempt;
    assert.equal(runner.results.at(-1).status, 'failed');
    assert.match(runner.results.at(-1).note, /it hung/);
  }
});

test('the resume wait rejects old history and accepts only an active or newly finished search', async t => {
  const original = globalThis.window;
  t.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  let data = {running: null, runs: [{id: 'old', kind: 'search', ok: true}]};
  globalThis.window = {pilot: {runs: async () => data}};
  assert.equal(await steps.resumedSearchSeen(['old']), false);
  data.running = {kind: 'mail'};
  assert.equal(await steps.resumedSearchSeen(['old']), false);
  data.running = {kind: 'search'};
  assert.equal(await steps.resumedSearchSeen(['old']), true);
  data.running = null;
  data.runs.push({id: 'new', kind: 'search', ok: false});
  assert.equal(await steps.resumedSearchSeen(['old']), false);
  data.runs[1].ok = true;
  assert.equal(await steps.resumedSearchSeen(['old']), true);
});

test('an owned step hang stops progression while ordinary failures still permit remaining checks', async t => {
  const {createRunner} = await import('../lib/runner.mjs');
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({apis: ['setTimeout']});
  const runner = createRunner(() => null, {keepGoing: true});
  const hung = runner.run('owned hang', () => new Promise(() => {}), {limitMs: 10, faults: true, stopOnHang: true});
  const rejected = assert.rejects(hung, /it hung/);
  await new Promise(setImmediate);
  t.mock.timers.tick(10);
  await rejected;
  assert.equal(runner.results.at(-1).status, 'failed');
  await runner.run('ordinary assertion', () => { throw new Error('wrong visible result'); }, {faults: true, stopOnHang: true});
  await runner.run('remaining check', async () => {});
  assert.equal(runner.results.at(-1).status, 'passed');
});

test('silence setup failure restores the normal instance, and closed teardown cannot relaunch it', async t => {
  const original = globalThis.window;
  t.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  globalThis.window = {pilot: {runs: async () => ({runs: [], historyLoaded: true, busy: []})}};
  const launches = [], modes = [];
  let closed = false;
  const ctx = {activityStateWaits: true, proxy: {setMode: mode => modes.push(mode)},
    page: {isClosed: () => closed, waitForSelector: async () => {}, evaluate: fn => fn()},
    relaunch: async env => { launches.push(env); if (env) throw new Error('startup failed'); }};
  assert.equal(typeof steps.withSilenceLimit, 'function');
  await assert.rejects(steps.withSilenceLimit(ctx, async () => assert.fail('setup did not finish')), /startup failed/);
  assert.deepEqual(launches, [{JOB_PILOTTO_E2E_IDLE_MS: '10000'}, undefined]);
  assert.deepEqual(modes, ['pass']);
  closed = true; launches.length = 0;
  await assert.rejects(steps.withSilenceLimit(ctx, async () => {}), /startup failed/);
  assert.equal(launches.length, 1, 'suite closure cannot be followed by a late relaunch');
});

test('a launch completing after suite teardown is closed rather than adopted', async () => {
  const {adoptSessionUnlessClosing} = await import('../lib/context.mjs');
  assert.equal(typeof adoptSessionUnlessClosing, 'function');
  const ctx = {closing: false}, adopted = [];
  let complete, closed = 0, started = 0;
  const opening = new Promise(resolve => { complete = resolve; });
  const pending = adoptSessionUnlessClosing(ctx, () => { started++; return opening; }, session => adopted.push(session));
  ctx.closing = true;
  complete({close: async () => { closed++; }});
  await pending;
  assert.equal(closed, 1, 'the newly opened instance is disposed');
  assert.equal(adopted.length, 0, 'a closed context cannot acquire another live app');
  await adoptSessionUnlessClosing(ctx, () => { started++; assert.fail('already closed'); }, () => assert.fail('already closed'));
  assert.equal(started, 1);
  ctx.closing = false;
  const session = {close: async () => assert.fail('normal launch must stay open')};
  await adoptSessionUnlessClosing(ctx, async () => session, value => adopted.push(value));
  assert.deepEqual(adopted, [session]);
});

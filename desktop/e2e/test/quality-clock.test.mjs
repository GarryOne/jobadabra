// Quality waits must observe complete current-attempt state and diagnose hangs without real waiting.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as waits from '../lib/quality-waits.mjs';
import {qualityJourney} from '../lib/quality-journey.mjs';
import * as quality from '../suites/quality.mjs';
import * as qualityai from '../suites/qualityai.mjs';

const clock = () => {
  let ms = 0;
  return {now: () => ms, pause: async tick => { ms += tick; }};
};
const fixture = t => {
  // quality refuses to start with stored answers off (suites/quality.mjs guard): these tests run its journey.
  const saved = process.env.E2E_AI_ANSWERS;
  process.env.E2E_AI_ANSWERS = 'backbone';
  t.after(() => { if (saved === undefined) delete process.env.E2E_AI_ANSWERS; else process.env.E2E_AI_ANSWERS = saved; });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-clock-'));
  t.after(() => fs.rmSync(profile, {recursive: true, force: true}));
  fs.mkdirSync(path.join(profile, 'logs'));
  fs.writeFileSync(path.join(profile, 'logs', 'engine.log'), 'engine evidence\n');
  const time = clock();
  const ctx = {profile, ARTIFACTS: profile, store: 'sqlite', suite: 'quality', needs: [],
    run: async (_name, fn) => fn(), data: async () => [], page: {evaluate: async () => []}};
  return {ctx, time};
};

test('state wait resolves as soon as its state arrives, without a fixed settling sleep', async () => {
  const time = clock();
  const value = await waits.waitForQualityState(() => time.now(), value => value >= 500,
    {label: 'the state', capMs: 1000, ...time});
  assert.equal(value, 500);
  assert.equal(time.now(), 500);
});

test('state wait throws a named HANG with its last state and evidence at the cap', async () => {
  const time = clock();
  await assert.rejects(waits.waitForQualityState(() => 'pending', () => false,
    {label: 'the Jobs check', capMs: 1000, evidence: value => `last=${value}; engine evidence`, ...time}), error => {
    assert.equal(error.name, 'QualityHangError');
    assert.match(error.message, /HANG: the Jobs check did not finish in 1 s: the app is hung, not slow/);
    assert.match(error.message, /last=pending; engine evidence/);
    return true;
  });
  assert.equal(time.now(), 1000);
});

test('an unresolved operation also throws the named hang and clears its timer', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const pending = waits.withQualityHang(() => new Promise(() => {}), {label: 'quality', capMs: 1000, evidence: () => 'engine evidence'});
  const rejected = assert.rejects(pending, {name: 'QualityHangError', message: /HANG: quality.*engine evidence/s});
  t.mock.timers.tick(1000);
  await rejected;
});

test('read2 never accepts optional rows in place of missing required postings', async t => {
  const {ctx, time} = fixture(t);
  const journey = qualityJourney(ctx, {wait: time});
  const required = journey.postings.filter(item => !item.filterMayDrop);
  const missing = required.at(-1);
  ctx.data = async () => journey.postings.filter(item => item.id !== missing.id).map(item => ({url: item.url, title: item.title}));
  await assert.rejects(journey.read2(), error => {
    assert.equal(error.name, 'QualityHangError');
    assert.ok(error.message.includes(`${required.length - 1} of ${required.length} required postings reached the store`));
    assert.ok(error.message.includes(missing.title));
    assert.match(error.message, /engine evidence/);
    return true;
  });
  assert.deepEqual(journey.rows, [], 'partial rows must never be published');
});

test('read2 accepts all required postings after the store commits, not before', async t => {
  const {ctx, time} = fixture(t);
  const journey = qualityJourney(ctx, {wait: time});
  ctx.data = async () => time.now() < 500 ? [] : journey.postings.filter(item => !item.filterMayDrop).map(item => ({url: item.url, title: item.title}));
  ctx.page.evaluate = async () => journey.postings.filter(item => !item.filterMayDrop).map(item => ({url: item.url}));
  await journey.read2();
  assert.equal(time.now(), 500);
  assert.equal(journey.rows.length, journey.postings.filter(item => !item.filterMayDrop).length);
});

for (const entity of ['matches', 'cron_runs']) test(`reset rejects existing ${entity} through the store before any mutation`, async t => {
  const {ctx} = fixture(t);
  const calls = [];
  ctx.data = async (name, action) => { calls.push([name, action]); return name === entity ? [{id: 'old'}] : []; };
  await assert.rejects(qualityJourney(ctx).reset(), {name: 'QualityStartStateError', message: new RegExp(`store holds 1 ${entity}`)});
  assert.ok(calls.every(([, action]) => action === 'list'));
});

test('an empty reset passes the emptiness assertion and does not delete history', async t => {
  const {ctx} = fixture(t);
  const marker = new Error('reached profile setup');
  const calls = [];
  ctx.data = async (name, action) => { calls.push([name, action]); if (name === 'texts') throw marker; return []; };
  ctx.page.evaluate = async () => { throw marker; };
  await assert.rejects(qualityJourney(ctx).reset(), error => error === marker);
  assert.deepEqual(calls, [['matches', 'list'], ['cron_runs', 'list'], ['texts', 'get']]);
});

test('quality leaves the speed budget and qualityai retains its larger live clocks', () => {
  assert.equal(quality.aggregateBudget, false);
  assert.equal(quality.budgetMinutes, undefined);
  assert.equal(quality.minutes, 3);
  assert.equal(qualityai.budgetMinutes, 10);
  assert.equal(qualityai.minutes, 24);
  assert.equal(quality.hangCaps['a Jobs check on the golden postings finishes and scores them'], 127.8);
  assert.equal(quality.hangCaps[''], 30);
});

test('quality sources contain no long sleeps or step overrides above the measured caps', () => {
  for (const file of ['../suites/quality.mjs', '../lib/quality-journey.mjs']) {
    const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const match of text.matchAll(/waitForTimeout\(\s*(\d+)\s*\)/g)) assert.ok(Number(match[1]) <= 1000, `${file}: ${match[0]}`);
    for (const match of text.matchAll(/limitMs:\s*([^,}\n]+)/g)) {
      assert.equal(match[1], 'clocks.jobsMs');
    }
  }
});

test('a pending state read cannot evade its own hang cap', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const pending = waits.waitForQualityState(() => new Promise(() => {}), () => false,
    {label: 'the store read', capMs: 1000, evidence: () => 'engine evidence'});
  const rejected = assert.rejects(pending, {name: 'QualityHangError', message: /HANG: the store read.*engine evidence/s});
  t.mock.timers.tick(1000);
  await rejected;
});

test('only this refresh can satisfy completion, even when its summary repeats an earlier one', async t => {
  const {ctx, time} = fixture(t);
  const prior = {id: 'before-reset', kind: 'search', ok: false, result: 'old failure'};
  const unrelated = {id: 'background', kind: 'mail', ok: false};
  const current = {id: 'this-refresh', kind: 'search', ok: true, result: 'same summary'};
  ctx.page.click = async () => {};
  ctx.page.evaluate = async () => ({running: null, queued: [], runs: time.now() < 500 ? [prior] : [unrelated, current, prior]});
  await qualityJourney(ctx, {wait: time}).check('first Jobs check');
  assert.equal(time.now(), 500, 'the earlier run must not satisfy the new refresh');
});

test('a completed failed current run stays a failure even with an older green run', async t => {
  const {ctx, time} = fixture(t);
  const old = {id: 'old', kind: 'search', ok: true};
  let clicked = false;
  ctx.page.click = async selector => { if (selector === '#refresh') clicked = true; };
  ctx.page.evaluate = async () => ({running: null, queued: [], runs: clicked ? [{id: 'current', kind: 'search', ok: false, result: 'new failure'}, old] : [old]});
  await assert.rejects(qualityJourney(ctx, {wait: time}).check('first Jobs check'), /ended as failed: new failure.*engine evidence/s);
});

test('the whole quality journey has a measured hang cap instead of the aggregate speed budget', async t => {
  const {ctx} = fixture(t);
  t.mock.timers.enable({apis: ['setTimeout']});
  ctx.page.evaluate = () => new Promise(() => {});
  const pending = quality.run(ctx);
  const rejected = assert.rejects(pending, {name: 'QualityHangError', message: /HANG: the quality journey did not finish in 162.6 s.*engine evidence/s});
  t.mock.timers.tick(162600);
  await rejected;
});

test('the runner preserves a named quality step hang with engine evidence', async t => {
  const {createRunner} = await import('../lib/runner.mjs');
  const {ctx} = fixture(t);
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({apis: ['setTimeout']});
  const runner = createRunner(() => null, {budgetMs: Infinity, hangCaps: quality.hangCaps});
  ctx.run = runner.run;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  ctx.page.evaluate = () => { entered(); return new Promise(() => {}); };
  const pending = quality.run(ctx);
  const rejected = assert.rejects(pending, {name: 'QualityHangError', message: /HANG: the app is set up.*30 s.*engine evidence/s});
  await started;
  t.mock.timers.tick(30000);
  await rejected;
  assert.match(runner.results[0].note, /HANG:.*engine evidence/s);
});


test('read2 waits for the Jobs page to reflect committed rows instead of relying on a settling sleep', async t => {
  const {ctx, time} = fixture(t);
  const journey = qualityJourney(ctx, {wait: time});
  const required = journey.postings.filter(item => !item.filterMayDrop);
  ctx.data = async () => required.map(item => ({url: item.url, title: item.title}));
  ctx.page.evaluate = async () => time.now() < 500 ? [] : required.map(item => ({url: item.url}));
  await journey.read2();
  assert.equal(time.now(), 500);
  assert.equal(journey.appJobs.length, required.length);
});

test('the outer Jobs cap keeps partial-store diagnostics when it fires before the row wait', async t => {
  const {createRunner} = await import('../lib/runner.mjs');
  const {ctx} = fixture(t);
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({apis: ['setTimeout']});
  ctx.built = true;
  const runner = createRunner(() => null, {budgetMs: Infinity, hangCaps: quality.hangCaps});
  // Setup/reset have separate coverage; hold this scenario in the Jobs step's store wait.
  ctx.run = (name, work, options) => name.startsWith('a Jobs check') ? runner.run(name, work, options) : Promise.resolve();
  let clicked = false, entered;
  const reading = new Promise(resolve => { entered = resolve; });
  ctx.page.click = async selector => { if (selector === '#refresh') clicked = true; };
  ctx.page.evaluate = async () => ({running: null, queued: [], runs: clicked ? [{id: 'current', kind: 'search', ok: true}] : []});
  ctx.data = async () => { entered(); return []; };
  const pending = quality.run(ctx);
  const rejected = assert.rejects(pending, error => {
    assert.equal(error.name, 'QualityHangError');
    assert.match(error.message, /0 of \d+ required postings reached the store; missing:.*engine evidence/s);
    return true;
  });
  await reading;
  await new Promise(setImmediate);
  t.mock.timers.tick(127800);
  await rejected;
  assert.match(runner.results[0].note, /required postings reached the store; missing:/);
});

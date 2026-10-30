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
  const journey = qualityJourney(ctx, {strict: true, wait: time});
  seedDiagnostics(ctx);
  const required = journey.postings.filter(item => !item.filterMayDrop);
  const missing = required.at(-1);
  ctx.data = async () => journey.postings.filter(item => item.id !== missing.id).map(item => ({url: item.url, title: item.title}));
  await assert.rejects(journey.read2(), error => {
    assert.equal(error.name, 'QualityHangError');
    assert.ok(error.message.includes(`${required.length - 1} of ${required.length} required postings reached the store`));
    assert.ok(error.message.includes(missing.title));
    assert.match(error.message, /engine evidence/);
    assertDiagnostics(error.message);
    return true;
  });
  assert.deepEqual(journey.rows, [], 'partial rows must never be published');
});

test('read2 accepts all required postings after the store commits, not before', async t => {
  const {ctx, time} = fixture(t);
  const journey = qualityJourney(ctx, {strict: true, wait: time});
  ctx.data = async () => time.now() < 500 ? [] : journey.postings.filter(item => !item.filterMayDrop).map(item => ({url: item.url, title: item.title}));
  ctx.page.evaluate = async () => journey.postings.filter(item => !item.filterMayDrop).map(item => ({url: item.url}));
  await journey.read2();
  assert.equal(time.now(), 500);
  assert.equal(journey.rows.length, journey.postings.filter(item => !item.filterMayDrop).length);
});

test('reset rejects existing matches by name through the store before any mutation', async t => {
  const {ctx} = fixture(t);
  const calls = [];
  ctx.data = async (name, action) => { calls.push([name, action]); return name === 'matches' ? [{id: 'old'}] : []; };
  await assert.rejects(qualityJourney(ctx).reset(), {name: 'QualityStartStateError', message: /store holds 1 matches/});
  assert.ok(calls.every(([, action]) => action === 'list'));
});

for (const runs of [[], [{id: 'startup', kind: 'search', ok: true}]]) test(`reset accepts ${runs.length} startup cron_runs rows without deleting history`, async t => {
  const {ctx} = fixture(t);
  const marker = new Error('reached profile setup');
  const calls = [];
  ctx.data = async (name, action) => { calls.push([name, action]); if (name === 'texts') throw marker; return name === 'cron_runs' ? runs : []; };
  ctx.page.evaluate = async () => { throw marker; };
  await assert.rejects(qualityJourney(ctx).reset(), error => error === marker);
  assert.deepEqual(calls, [['matches', 'list'], ['texts', 'get']]);
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

// Why (30 Oct 2026, qu): RECORD makes live calls; replay's measured caps must not kill healthy engine work.
for (const [mode, stateSeconds, jobsSeconds, suiteMs, minutes] of [
  ['record', 90, 360, 480000, 8], ['backbone', 30, 127.8, 162600, 3],
]) test(`${mode}: quality exports and enforces the matching state, Jobs and whole-journey caps`, async t => {
  const {ctx, time} = fixture(t);
  process.env.E2E_AI_ANSWERS = mode;
  const suite = await import(`../suites/quality.mjs?clock=${mode}`);
  assert.equal(suite.hangCaps[''], stateSeconds);
  assert.equal(suite.hangCaps['a Jobs check on the golden postings finishes and scores them'], jobsSeconds);
  assert.equal(suite.minutes, minutes);

  // An unresolved state read exercises the journey's own timer without running the app.
  t.mock.timers.enable({apis: ['setTimeout']});
  ctx.page.click = async () => {};
  let reads = 0;
  ctx.page.evaluate = async () => ++reads === 1 ? {running: null, queued: [], runs: []} : new Promise(() => {});
  const journey = qualityJourney(ctx, {strict: true, wait: time});
  const check = assert.rejects(journey.check('first Jobs check'), {name: 'QualityHangError', message: new RegExp(`did not finish in ${jobsSeconds} s`)});
  await new Promise(setImmediate);
  t.mock.timers.tick(jobsSeconds * 1000);
  await check;

  ctx.run = () => new Promise(() => {});
  let settled = false;
  const pending = suite.run(ctx).finally(() => { settled = true; });
  const rejected = assert.rejects(pending, {name: 'QualityHangError', message: new RegExp(`the quality journey did not finish in ${suiteMs / 1000} s`)});
  await new Promise(setImmediate);
  t.mock.timers.tick(suiteMs - 1);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await rejected;
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
  await qualityJourney(ctx, {strict: true, wait: time}).check('first Jobs check');
  assert.equal(time.now(), 500, 'the earlier run must not satisfy the new refresh');
});

test('a completed failed current run stays a failure even with an older green run', async t => {
  const {ctx, time} = fixture(t);
  const old = {id: 'old', kind: 'search', ok: true};
  let clicked = false;
  ctx.page.click = async selector => { if (selector === '#refresh') clicked = true; };
  ctx.page.evaluate = async () => ({running: null, queued: [], runs: clicked ? [{id: 'current', kind: 'search', ok: false, result: 'new failure'}, old] : [old]});
  await assert.rejects(qualityJourney(ctx, {strict: true, wait: time}).check('first Jobs check'), /ended as failed: new failure.*engine evidence/s);
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
  const journey = qualityJourney(ctx, {strict: true, wait: time});
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
  seedDiagnostics(ctx);
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
    assertDiagnostics(error.message);
    return true;
  });
  await reading;
  await new Promise(setImmediate);
  t.mock.timers.tick(127800);
  await rejected;
  assert.match(runner.results[0].note, /required postings reached the store; missing:/);
});


// These files stand in for a search whose feed/config details must survive a strict hang.
const seedDiagnostics = ctx => {
  ctx.feeds = path.join(ctx.profile, 'feeds');
  fs.mkdirSync(ctx.feeds);
  fs.writeFileSync(path.join(ctx.feeds, 'board.json'), '{}');
  const config = path.join(ctx.profile, 'config');
  fs.mkdirSync(config);
  fs.writeFileSync(path.join(config, 'sources.json'), '[{"company":"Diagnostic fixture"}]');
  fs.writeFileSync(path.join(config, 'search.json'), '{"locations":{"top_tier":["zurich"]}}');
};
const assertDiagnostics = message => {
  assert.match(message, /profile config: .*sources.json/);
  assert.match(message, /sources.json: .*Diagnostic fixture/);
  assert.match(message, /feed folder: board.json/);
  assert.match(message, /search.json: .*zurich/);
};

test('non-strict read2 keeps partial qualityai rows after 90 s without waiting for the Jobs page', async t => {
  const {ctx, time} = fixture(t);
  ctx.suite = 'qualityai';
  const journey = qualityJourney(ctx, {wait: time});
  const required = journey.postings.filter(item => !item.filterMayDrop);
  ctx.data = async () => [{url: required[0].url, title: required[0].title}];
  ctx.page.evaluate = async () => [];
  await journey.read2();
  assert.equal(time.now(), 90000);
  assert.deepEqual(journey.rows.map(row => row.props['Job URL']), [required[0].url]);
  assert.deepEqual(journey.appJobs, []);
});

test('non-strict read2 accepts a full store without waiting for an empty Jobs page', async t => {
  const {ctx, time} = fixture(t);
  ctx.suite = 'qualityai';
  const journey = qualityJourney(ctx, {wait: time});
  const required = journey.postings.filter(item => !item.filterMayDrop);
  ctx.data = async () => required.map(item => ({url: item.url, title: item.title}));
  await journey.read2();
  assert.equal(time.now(), 0);
  assert.equal(journey.rows.length, required.length);
  assert.deepEqual(journey.appJobs, []);
});

test('non-strict Jobs still diagnoses an empty store after the read allowance', async t => {
  const {ctx, time} = fixture(t);
  ctx.suite = 'qualityai';
  seedDiagnostics(ctx);
  let clicked = false;
  ctx.page.click = async selector => { if (selector === '#refresh') clicked = true; };
  ctx.page.evaluate = async () => ({running: null, queued: [], runs: clicked ? [{id: 'current', kind: 'search', ok: true}] : []});
  await assert.rejects(qualityJourney(ctx, {wait: time}).jobs(), error => {
    assert.equal(error.name, 'Error');
    assert.match(error.message, /no Job Matches row.*90 s/);
    assertDiagnostics(error.message);
    return true;
  });
});

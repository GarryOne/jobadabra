// Recent activity on the store on this Mac: run records come through the engine (python -m src.stores call), never a second copy of its
// schema; a run this Mac tracked (runs.json) merges with its record by the link the engine prints, so it shows once.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as engine from '../lib/store/engine.js';
import * as sqliteStore from '../lib/store/sqlite.js';
import {fromRecord, recordLink} from '../lib/run-rows.js';
import {merge} from '../lib/run-history.js';

const storage = {settings: () => ({store: 'sqlite'}), readText: () => '', writeText: () => {}};
const now = Date.now(), iso = ms => new Date(ms).toISOString();
const ROWS = {
  r1: {id: 'r1', kind: 'mail', where: 'mac', status: 'OK', started_at: iso(now - 60000), finished_at: iso(now - 30000), summary: 'Checked 4 emails (AI cost $0.01)',
    report: 'Checked 4 emails\nWarning: one sender unread', result: 'Gmail check: 4 emails', log: '', progress: []},
  r2: {id: 'r2', kind: 'scheduled', where: 'mac', status: 'Running', started_at: iso(now - 5000), finished_at: '', summary: '', report: '', result: '', log: '',
    progress: ['⏳ Reading 12 feeds']},
};
function fakeEngine() {
  const calls = [];
  const call = async (_, entity, method, kwargs) => {
    calls.push([entity, method, kwargs]);
    if (method === 'list') return Object.values(ROWS).reverse();
    if (method === 'get') return ROWS[kwargs.run_id] || null;
    if (method === 'finish') { Object.assign(ROWS[kwargs.run_id], {status: kwargs.status, summary: kwargs.summary}); return ROWS[kwargs.run_id]; }
    throw new Error(method);
  };
  return {call, calls};
}

test('this Mac: the run list, a live run and a finished one, as activity records', async () => {
  const {call, calls} = fakeEngine();
  const runs = await sqliteStore.open(storage, {call}).runs.list({size: 25});
  assert.equal(calls[0][0], 'cron_runs');
  assert.ok(calls[0][2].since);
  const [live, done] = runs;
  assert.deepEqual([live.live, live.step, live.kind, live.notionUrl], [true, 'Reading 12 feeds', 'search', recordLink('r2')]);
  assert.deepEqual([done.ok, done.kind, done.result, done.where], [true, 'mail', 'Checked 4 emails', 'mac']);
});

test('this Mac: a stopped run is closed Failed with why; one that already ended is left alone', async () => {
  const {call} = fakeEngine();
  const runs = sqliteStore.open(storage, {call}).runs;
  assert.equal(await runs.close(recordLink('r2'), 'Stopped by Jobadabra'), true);
  assert.equal(ROWS.r2.status, 'Failed');
  assert.equal(await runs.close(recordLink('r1'), 'x'), false);
  assert.deepEqual(await runs.detail(recordLink('r1')), {message: 'Gmail check: 4 emails', log: ['Checked 4 emails', 'Warning: one sender unread'],
    report: ['Checked 4 emails', 'Warning: one sender unread']});
});

test('a run this Mac tracked merges with its store record by the printed link: listed once', () => {
  const record = fromRecord(ROWS.r1);
  const local = {id: 1, kind: 'mail', startedAt: ROWS.r1.started_at, endedAt: ROWS.r1.finished_at, ok: true, notionUrl: recordLink('r1'), log: ['full log']};
  const merged = merge([record], [local]);
  assert.equal(merged.runs.length, 1);
  assert.deepEqual(merged.runs[0].log, ["full log"]);   // this Mac's own record (full log) over the store's
});

test('the engine call: stdout\'s last line is the answer; an error or a silent engine throws', async () => {
  const answering = stdout => async () => ({code: stdout.includes('error') ? 1 : 0, stdout});
  assert.deepEqual(await engine.call({}, 'cron_runs', 'list', {}, {run: answering('Using the Desktop App\'s folder\n{"result": [1]}')}), [1]);
  await assert.rejects(engine.call({}, 'cron_runs', 'get', {}, {run: answering('{"error": "KeyError: x"}')}), /refused cron_runs\.get: KeyError: x/);
  await assert.rejects(engine.call({}, 'cron_runs', 'get', {}, {run: async () => ({code: 1, stdout: 'Traceback'})}), /did not answer/);
  let args;
  await engine.call({}, 'cron_runs', 'list', {since: 'x'}, {run: async (_, a) => { args = a; return {code: 0, stdout: '{"result": []}'}; }});
  assert.deepEqual(args, ['src.stores', 'call', 'cron_runs', 'list', '{"since":"x"}']);
});

test('parity: one run as a Notion row and as a store record reads the same in Recent activity', async () => {
  const {fromRow} = await import('../lib/run-rows.js');
  const started = '2026-10-09T10:00:00.000Z';
  const rt = value => ({rich_text: [{plain_text: value}]});
  const page = {id: 'abc', url: 'https://www.notion.so/abc', created_time: started, last_edited_time: started, properties: {
    Started: {date: {start: started}}, Mode: {select: {name: 'scheduled'}}, Status: {select: {name: 'Warnings'}}, Trigger: {select: {name: 'Mac schedule'}},
    'Duration (s)': {number: 90}, Summary: rt('3 new jobs (AI cost $0.12)'), 'New jobs': {number: 3}, Feeds: {number: 40},
    'AI cost (USD)': {number: 0.12}, 'Billed to': {select: {name: 'Your plan'}}, Telegram: rt('🔎 3 new jobs'), 'Run id': rt('run-7f3a')}};
  const record = {id: 'r9', kind: 'scheduled', mode: 'scheduled', where: 'mac', status: 'Warnings', trigger: 'Mac schedule', started_at: started,
    finished_at: '', summary: '3 new jobs (AI cost $0.12)', report: '', result: '', log: '', progress: [], run_url: '', application: '', log_id: 'run-7f3a',
    stats: {new_jobs: 3, feeds: 40, ai_cost_usd: 0.12, billed_to: 'Your plan', duration_s: 90, telegram: 1}};
  const pick = run => ({kind: run.kind, mode: run.mode, trigger: run.trigger, where: run.where, ok: run.ok, warned: run.warned, new: run.new, feeds: run.feeds,
    usd: run.usd, billing: run.billing, result: run.result, endedAt: run.endedAt, startedAt: run.startedAt, url: run.url, startedBy: run.startedBy, telegram: run.telegram, runId: run.runId});
  assert.deepEqual([fromRow(page, Date.parse(started) + 3600000).startedBy, fromRow(page, Date.parse(started) + 3600000).telegram], ['Mac schedule', true], 'the fields are set, not equal by being empty')
  assert.equal(fromRow(page, Date.parse(started) + 3600000).runId, 'run-7f3a')
  assert.deepEqual(pick(fromRecord(record, Date.parse(started) + 3600000)), pick(fromRow(page, Date.parse(started) + 3600000)));
});

// #339: a run killed hard keeps Status Running; the engine's heartbeat (started + elapsed seconds) is its last sign of life, as a Notion row's last edit is.
test('a Running store row with no sign of life for 30 minutes is not live, one with a recent heartbeat is', () => {
  const row = (startedAgoMin, seconds) => ({id: 'k', kind: 'scheduled', where: 'mac', status: 'Running', started_at: iso(now - startedAgoMin * 60000),
    summary: '', progress: ['⏳ Reading 12 feeds'], stats: seconds == null ? {} : {duration_s: seconds}});
  assert.equal(fromRecord(row(40, 120), now).live, undefined, 'started 40 min ago, last beat at 2 min: lost');
  assert.equal(fromRecord(row(40, null), now).live, undefined, 'started 40 min ago, never beat: lost');
  assert.equal(fromRecord(row(40, 39 * 60), now).live, true, 'started 40 min ago, beat a minute ago: alive');
  assert.equal(fromRecord(row(1, null), now).live, true, 'just started: alive');
});

test('an Always on run (matches that arrived while the Mac was off) reads as a run on our servers with its own words', () => {
  const run = fromRecord({id: 'r1', kind: 'scheduled', mode: 'scheduled', where: 'cloud', status: 'OK', trigger: 'Always on', started_at: '2026-10-17T07:00:00+00:00',
    finished_at: '2026-10-17T07:00:00+00:00', summary: '3 new jobs while you were away', stats: {new_jobs: 3}}, Date.parse('2026-10-17T08:00:00Z'));
  assert.deepEqual([run.where, run.trigger, run.result, run.ok, run.kind], ['cloud', 'schedule', '3 new jobs while you were away', true, 'search']);
});

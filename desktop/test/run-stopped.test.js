// A run the watchdog stops (a silent AI) is killed, and a killed Python cannot close its own Notion row: it stayed "Running" and the app showed the task as running
// for 3 hours (2 Oct 2026, found by the activity e2e suite). The app closes the row of a run it stopped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import * as runHistory from '../lib/run-history.js';

const PAGE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const URL = `https://app.notion.com/p/2026-10-02-17-09-Jobs-check-${PAGE}`;
const json = body => ({ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Map()});

test('closeStopped fails a row still Running, and leaves a row that was closed alone', async () => {
  const calls = [];
  const rows = {running: 'Running', done: 'OK'};
  for (const [name, status] of Object.entries(rows)) {
    calls.length = 0;
    const fetcher = async (url, init) => { calls.push([init.method, String(url).replace('https://api.notion.com/v1/', ''), init.body]); return json({id: PAGE, properties: {Status: {select: {name: status}}}}); };
    const storage = {secret: () => 'token', settings: () => ({})};
    const closed = await runHistory.closeStopped(storage, URL, 'Stopped by Jobadabra: no output for 1 min', {fetcher});
    assert.equal(closed, status === 'Running', name);
    const patch = calls.find(call => call[0] === 'PATCH');
    if (status === 'Running') {
      assert.match(patch[1], /^pages\/[0-9a-f-]+$/);
      assert.equal(patch[1].replace(/\D*pages\//, '').replace(/-/g, ''), PAGE);
      const body = JSON.parse(patch[2]);
      assert.equal(body.properties.Status.select.name, 'Failed');
      assert.match(body.properties.Summary.rich_text[0].text.content, /Stopped by Jobadabra/);
    } else assert.equal(patch, undefined);
  }
});

test('a run stopped by the watchdog has its Notion row closed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-stopped-'));
  fs.writeFileSync(path.join(dir, 'quietrun.py'), `print('Cronjob run logged: ${URL}', flush=True)\nimport time\ntime.sleep(60)\n`);
  const storage = {settings: () => ({}), secret: name => (name === 'NOTION_TOKEN' ? 'token' : ''), saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts)};
  const saved = {...pipeline.LIMITS}, realFetch = globalThis.fetch, calls = [];
  // The quiet limit applies once the run has said where its row is: a Python slow to start on a loaded machine (9 Oct 2026, load ~430) was
  // killed before it printed the row's URL, so there was no row to close and the test failed. The watchdog reads LIMITS at every check.
  Object.assign(pipeline.LIMITS, {idleMs: 60000, totalMs: 60000, checkMs: 100, killAfterMs: 500, watchAll: true});
  const onLine = line => { if (/Cronjob run logged/.test(line)) pipeline.LIMITS.idleMs = 300; };
  globalThis.fetch = async (url, init) => { calls.push([init?.method, String(url), init?.body]); return json({id: PAGE, properties: {Status: {select: {name: 'Running'}}}}); };
  try {
    const {timedOut} = await pipeline.run(storage, ['quietrun'], onLine, {PYTHONPATH: dir});
    assert.match(timedOut, /no output for/);
  } finally { Object.assign(pipeline.LIMITS, saved); globalThis.fetch = realFetch; }
  const patch = calls.find(call => call[0] === 'PATCH');
  assert.ok(patch, `the row was not closed (calls: ${calls.map(call => call[0]).join(', ') || 'none'})`);
  assert.equal(JSON.parse(patch[2]).properties.Status.select.name, 'Failed');
});

// #91 (Windows): the app quit under a run, the engine died with it, and its Notion row stayed Running. On resume the app closes this Mac's matching row, once, and only that one.
test('closeInterrupted closes the Running row of the run the quit killed, not another kind, another start time or a finished run', async () => {
  const calls = [];
  const at = Date.now() - 2 * 60 * 1000;   // relative to now: a Running row counts as live for 3 h only (a fixed date made this test fail after 22:17 UTC on 3 Oct)
  const row = (id, mode, status, minutesFromJob, trigger = 'Mac (you)') => ({id, url: `https://app.notion.com/p/${id}`, created_time: new Date(at).toISOString(),
    properties: {Started: {date: {start: new Date(at + minutesFromJob * 60000).toISOString()}}, Mode: {select: {name: mode}}, Status: {select: {name: status}}, Trigger: {select: {name: trigger}}, Summary: {rich_text: []}}});
  const pages = [row('a'.repeat(32), 'run', 'Running', 0.4), row('b'.repeat(32), 'mail', 'Running', 0.1), row('c'.repeat(32), 'run', 'Running', 40), row('d'.repeat(32), 'run', 'OK', 0.2),
    row('e'.repeat(32), 'run', 'Running', 0.2, 'Schedule')];
  const fetcher = async (url, init) => {
    const route = String(url).replace('https://api.notion.com/v1/', '');
    calls.push([init.method, route]);
    if (init.method === 'POST') return json({results: pages});
    return json(pages.find(page => route.endsWith(page.id)) || {properties: {}});
  };
  const storage = {secret: () => 'token', settings: () => ({notionIds: {NOTION_CRON_RUNS_DB: 'db'}})};
  const job = {kind: 'search', trigger: 'you', queuedAt: new Date(at).toISOString(), resume: {mode: 'run'}, interrupted: true};
  const closed = await runHistory.closeInterrupted(storage, [job], {fetcher});
  assert.equal(closed.length, 1);
  const patched = calls.filter(call => call[0] === 'PATCH');
  assert.equal(patched.length, 1, JSON.stringify(calls));
  assert.match(patched[0][1], /aaaaaaaa/, 'the search row at the job\'s start time, not the mail row, the 40-minute-later row, the finished row or the GitHub row');
  assert.deepEqual(await runHistory.closeInterrupted(storage, [{...job, interrupted: false}], {fetcher}), [], 'a job that was only waiting has no row to close');
});

test('closeLost closes the Mac\'s Running rows that began with the lost run, and no other', async () => {
  const calls = [], began = Date.now() - 30 * 60 * 1000;
  const row = (id, status, minutes, trigger = 'Mac schedule') => ({id, url: `https://app.notion.com/p/${id}`, created_time: new Date(began).toISOString(),
    properties: {Started: {date: {start: new Date(began + minutes * 60000).toISOString()}}, Mode: {select: {name: 'run'}}, Status: {select: {name: status}}, Trigger: {select: {name: trigger}}, Summary: {rich_text: []}}});
  const pages = [row('a'.repeat(32), 'Running', 0.5), row('b'.repeat(32), 'Running', 20), row('c'.repeat(32), 'OK', 0.2), row('d'.repeat(32), 'Running', 0.2, 'Schedule')];
  const fetcher = async (url, init) => {
    const route = String(url).replace('https://api.notion.com/v1/', '');
    calls.push([init.method, route]);
    if (init.method === 'POST') return json({results: pages});
    return json(pages.find(page => route.endsWith(page.id)) || {properties: {}});
  };
  const storage = {secret: () => 'token', settings: () => ({notionIds: {NOTION_CRON_RUNS_DB: 'db'}})};
  const closed = await runHistory.closeLost(storage, began, 'Stopped: lost.', {fetcher});
  assert.equal(closed.length, 1);
  assert.deepEqual(calls.filter(call => call[0] === 'PATCH').map(call => call[1].slice(-32)), ['a'.repeat(32)]);
});

// 24 Oct 2026 rename: runs stopped before it were stored as "Stopped by Job Pilotto: ..."; the activity card still reads them.
test('a stopped run is recognised under the old and the new product name', async () => {
  const {stoppedHead} = await import('../renderer/run-status.js');
  for (const name of ['Jobadabra', 'Job Pilotto']) {
    const head = stoppedHead({ok: false, summary: `Stopped by ${name}: no output for 15 min. The run went quiet, so it was stopped.`});
    assert.ok(head, `${name}: the stopped run is read`);
  }
});

// Export job list (Pro): the columns, a CSV safe from formulas, JSON, and the gate in the main process (free refused, a paid account or an owner key allowed).
// Guards lib/jobs-export.js, lib/jobs-export-handlers.js and the window's button / ⌘K entry (source checks).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {COLUMNS, canExport, chosen, formatOf, safeCell, toCsv, toJson} from '../lib/jobs-export.js';
import {registerJobsExportHandlers} from '../lib/jobs-export-handlers.js';

const JOBS = [
  {title: 'Senior SRE', company: 'Helvetic Cloud', location: 'Zurich', work_mode: 'Hybrid', status: 'applied', stage: 'Interview scheduled', fit: '91', url: 'https://x.test/1',
    posted_at: '2026-10-01T08:00:00Z', first_seen_at: '2026-10-02', next_interview: '2026-11-12T10:00:00+01:00', notes: 'Call "Anna", ask about on-call'},
  {title: '=HYPERLINK("http://evil")', company: '+cmd', location: '@home', status: 'unreviewed', fit: null, url: 'https://x.test/2'},
];

test('the columns are the ones listed and carry the job\'s values', () => {
  assert.deepEqual(COLUMNS.map(([name]) => name), ['Role', 'Company', 'Location', 'Work mode', 'Status', 'Match', 'Link', 'Posted', 'Found', 'Interview', 'Notes']);
  const rows = JSON.parse(toJson(JOBS));
  assert.equal(rows[0].Status, 'Interview scheduled');
  assert.equal(rows[0].Match, 91);
  assert.equal(rows[0].Posted, '2026-10-01');
  assert.equal(rows[1].Match, '');
  assert.ok(!/fit_detail|reason|score/i.test(Object.keys(rows[0]).join()), 'no internal scoring words in the columns');
});

test('CSV: a cell that starts like a formula becomes text; quotes and commas are quoted; Excel gets a BOM', () => {
  for (const bad of ['=1+1', '+1', '-1', '@x', '\tx', '\rx']) assert.ok(safeCell(bad).replace(/^"/, '').startsWith("'"), bad);
  assert.equal(safeCell('plain'), 'plain');
  const csv = toCsv(JOBS);
  assert.ok(csv.startsWith('\uFEFFRole,Company'));
  assert.ok(csv.includes('"Call ""Anna"", ask about on-call"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""http://evil"")"'));
  assert.ok(csv.includes(",'+cmd,") && csv.includes(",'@home,"));
  assert.ok(csv.endsWith('\r\n'));
});

test('the view or all: only the jobs whose link was sent, unless all', () => {
  assert.deepEqual(chosen(JOBS, {urls: ['https://x.test/2']}).map(job => job.url), ['https://x.test/2']);
  assert.equal(chosen(JOBS, {all: true}).length, 2);
  assert.equal(chosen(JOBS, {}).length, 0);
});

test('the format follows the picked extension, also on a Windows path', () => {
  assert.equal(formatOf('/Users/a/jobs.json'), 'json');
  assert.equal(formatOf('C:\\Users\\Ana\\Documents\\jobs.JSON'), 'json');
  assert.equal(formatOf('C:\\Users\\Ana\\Documents\\jobs.csv'), 'csv');
  assert.equal(formatOf('jobs'), 'csv');
});

test('the licence gate: free is refused with no dialog and no file; a Pro account and an owner key pass', async () => {
  assert.equal(canExport({licensed: false, proMode: 'live'}), false);
  assert.equal(canExport({licensed: true, license: {kind: 'pro'}}), true);
  assert.equal(canExport({licensed: true, license: {kind: 'founder'}}), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-export-'));
  const file = path.join(dir, 'jobs.csv');
  const run = async (state, options = {all: true}) => {
    let asked = 0, handler;
    registerJobsExportHandlers({DEMO: false, app: {getPath: () => dir}, getWindow: () => null, ipcMain: {handle: (_, fn) => { handler = fn; }}, licenseState: () => state, storage: {},
      dialog: {showSaveDialog: async () => { asked++; return {canceled: false, filePath: file}; }}, readJobs: async () => ({jobs: JOBS})});
    return {answer: await handler({}, options), asked};
  };
  const free = await run({licensed: false});
  assert.equal(free.answer.pro, true); assert.equal(free.asked, 0); assert.equal(fs.existsSync(file), false);
  const key = await run({licensed: true, license: {kind: 'founder'}});
  assert.equal(key.answer.ok, true); assert.equal(key.answer.count, 2);
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('\uFEFFRole'));
  const view = await run({licensed: true}, {urls: ['https://x.test/1']});
  assert.equal(view.answer.count, 1);
});

test('the window: a button on the Jobs toolbar and a ⌘K entry, both through the one IPC', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const nav = fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8');
  assert.ok(html.includes('id="jobs-export"'));
  assert.ok(nav.includes('Export job list'));
  assert.ok(preload.includes("exportJobs: call('exportJobs')"));
});

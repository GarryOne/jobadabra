// lib/record-sites-record.mjs: a smoke site's result is saved to the day's report the moment the site ends, so stopping a run loses only the site in progress.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {earlierReports, recordSite} from '../../lib/record-sites-record.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'record-sites-record-'));
const read = (dir, day) => JSON.parse(fs.readFileSync(path.join(dir, `${day}.json`), 'utf8'));

test('each site is in the day report as soon as it is recorded; a run stopped after two sites keeps both', () => {
  const dir = temp();
  recordSite({dir, day: '2026-10-12', shape: 'A', result: {url: 'u1', reached: 'form'}, earlier: {}});
  assert.deepEqual(Object.keys(read(dir, '2026-10-12').results), ['A']);   // saved before the next site starts
  recordSite({dir, day: '2026-10-12', shape: 'B', result: {url: 'u2', reached: 'posting'}, earlier: {}});
  assert.deepEqual(Object.keys(read(dir, '2026-10-12').results), ['A', 'B']);
});

test('a second run on the same day (--only) adds to the report and never drops what the first run saved', () => {
  const dir = temp();
  recordSite({dir, day: '2026-10-12', shape: 'A', result: {reached: 'form'}, earlier: {}});
  recordSite({dir, day: '2026-10-12', shape: 'C', result: {reached: 'form'}, earlier: {}});   // another process, same day
  recordSite({dir, day: '2026-10-12', shape: 'A', result: {reached: 'posting'}, earlier: {}});   // A rerun: the newer result wins
  const {results} = read(dir, '2026-10-12');
  assert.deepEqual([Object.keys(results).sort(), results.A.reached, results.C.reached], [['A', 'C'], 'posting', 'form']);
});

test('a site that reached less than ITS last run is a regression, saved with the report and returned; a better one clears it', () => {
  const dir = temp(), earlier = {A: {reached: 'form', url: 'u'}};
  const found = recordSite({dir, day: '2026-10-12', shape: 'A', result: {reached: 'posting', url: 'u'}, earlier});
  assert.match(found.why, /reached posting, last time form/);
  assert.equal(read(dir, '2026-10-12').regressions.length, 1);
  assert.equal(recordSite({dir, day: '2026-10-12', shape: 'A', result: {reached: 'form', url: 'u'}, earlier}), null);
  assert.equal(read(dir, '2026-10-12').regressions.length, 0);
});

test('earlier reports are the days before, never today; an unreadable file is skipped', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, '2026-10-11.json'), JSON.stringify({day: '2026-10-11', results: {A: {reached: 'form'}}}));
  fs.writeFileSync(path.join(dir, '2026-10-12.json'), JSON.stringify({day: '2026-10-12', results: {}}));
  fs.writeFileSync(path.join(dir, '2026-10-10.json'), '{broken');
  assert.deepEqual(earlierReports(dir, '2026-10-12').map(report => report.day), ['2026-10-11']);
});

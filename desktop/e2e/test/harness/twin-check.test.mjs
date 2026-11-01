// The post-merge live check's pure parts (lib/twin-check.mjs): one pool row per platform, what is red (a fill error, a press the floor refuses, a drop vs the last check), the table.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {PLATFORMS, checkOf, dropVs, pickRows, pressProblems, tableOf, verdictOf} from '../../lib/twin-check.mjs';

const pool = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..', 'smoke-sites.json'), 'utf8')).shapes;
const line = (what, label) => `2026-10-15T20:00:00.000Z [extension] fill: ${what}: ${JSON.stringify({label})}`;

test('every platform has a pool row with a posting', () => {
  for (const row of pickRows(pool)) assert.ok(row.url, `${row.platform}: no pool row matches its shape in smoke-sites.json`);
  assert.equal(pickRows(pool).length, PLATFORMS.length);
});

test('a press of the Submit floor is refused; a "Decline" press is refused; a popup that says no is only looked at', () => {
  const log = [line('pressed Send application', 'Send application'), line('pressed the control', 'Decline'), line('closed a popup', 'Reject all'), line('pressed the control', 'Next')].join('\n');
  const found = pressProblems(log);
  assert.equal(found.bad.length, 2, JSON.stringify(found));
  assert.equal(found.popups.length, 1);
});

test('each kind of problem makes a row red, a clean row is green, a drop vs last is red', () => {
  const row = {platform: 'Lever', shape: 's', url: 'u'};
  const clean = checkOf({row, result: {reached: 'ready', filled: 8, left: 0, errors: []}});
  assert.equal(verdictOf(clean, null).red, false);
  assert.equal(verdictOf(clean, {reached: 'ready', filled: 8}).red, false);
  assert.ok(verdictOf(checkOf({row, result: {reached: 'ready', filled: 8, left: 0, errors: ["TypeError: Cannot read properties of undefined (reading 'trace')"]}}), null).red, 'a fill error');
  assert.ok(verdictOf(checkOf({row, result: {reached: 'ready', filled: 8, left: 0, errors: []}, appLog: "Uncaught TypeError: x is not a function"}), null).red, 'a thrown error in the app log');
  assert.ok(verdictOf(checkOf({row, result: {reached: 'ready', filled: 8, left: 0, errors: []}, appLog: line('pressed x', 'Decline')}), null).red, 'a refused press');
  assert.ok(verdictOf(checkOf({row, result: {reached: 'ready', filled: 8, left: 0, errors: [], tripped: true}}), null).red, 'the tripwire');
  assert.match(dropVs({reached: 'ready', filled: 8}, {reached: 'form', filled: 3}), /reached form, was ready/);
  assert.match(dropVs({reached: 'form', filled: 8}, {reached: 'form', filled: 5}), /filled 5, was 8/);
  assert.equal(dropVs({reached: 'form', filled: 5}, {reached: 'ready', filled: 8}), '');
});

test('the table has one line per platform and says red or green', () => {
  const row = {platform: 'Ashby', shape: 's', url: 'u'};
  const check = checkOf({row, result: {reached: 'form', filled: 4, left: 2, errors: []}, panel: '/x/end.png'});
  const text = tableOf([{platform: 'Ashby', check, last: null, verdict: verdictOf(check, null)}, {platform: 'Lever', skipped: 'site rests'}], {sha: 'abc1234567'});
  assert.match(text, /\| Ashby \| form \| 4 \/ 2 \|/);
  assert.match(text, /skipped: site rests/);
  assert.match(text, /no red/);
});

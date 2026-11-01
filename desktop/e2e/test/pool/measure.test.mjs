// npm run measure's safeguards (lib/measure.mjs; spec 2026-10-13-capture-once-measure-many.md): offline numbers are labelled and never share a table with live ones, a row the
// capture did not cover is not measured, a press no capture saw is unseen, and every output says "unverified" until the positive control passed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {RUN_SETTINGS} from '../../lib/capture-library.mjs';
import {VERIFIED, capturesOf, measuredRow, missesIn, settingsOf, unreplayedRow, offlineLabel, pressesOf, readingOf, tableLines, tablesOf} from '../../lib/measure.mjs';

const acted = (at, why, effect) => `2026-10-13T06:00:${at}.000Z [extension] fill: dead end fallback (acted) {"door":${Number(at)},"why":"${why}","effect":"${effect}"}`;
const kind = (at, what) => `2026-10-13T06:00:${at}.000Z [extension] fill: page kind: ${what} {"by":"ai"}`;
function capture(root, {day = '2026-10-13', name = 'lever-060000', row = 'Lever: single page', kept = 10, log = ''} = {}) {
  const dir = path.join(root, day, name);
  fs.mkdirSync(path.join(dir, 'pages'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify({pages: [{url: 'https://jobs.example.org/a', file: 'pages/1.html'}]}));
  fs.writeFileSync(path.join(dir, 'capture.json'), JSON.stringify({row, build: {commit: 'abc', extension: '0.9.300'}}));
  fs.writeFileSync(path.join(dir, 'model-memo.json'), JSON.stringify(Object.fromEntries(Array.from({length: kept}, (_, i) => [[`k${i}`, {}], [`k${i}#ms`, 1]]).flat())));
  fs.writeFileSync(path.join(dir, 'app.log'), log);
  return dir;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-measure-'));

test('1: every line is labelled offline (memo), "unverified" until the positive control passed; offline and live are separate tables', () => {
  assert.equal(VERIFIED, false, 'the positive control (spec PR 3) has not passed yet');
  assert.equal(offlineLabel(), 'offline (memo), unverified');
  assert.equal(offlineLabel({ask: true, verified: true}), 'offline (plan)');
  const dir = capture(tmp(), {log: kind('01', 'form')});
  const row = measuredRow(dir, {appLog: kind('01', 'form'), misses: 0});
  const lines = tableLines(tablesOf([row], 'offline'), offlineLabel());
  assert.ok(lines.every(line => line.startsWith('[offline (memo), unverified] ')), lines.join('\n'));
  assert.ok(tableLines(tablesOf([row], 'live'), 'live').every(line => line.startsWith('[live] ')));
});

// The app's own line of a miss (13 Oct 2026, HelloFresh: this one miss of 16 took the fill from 5 to 1).
const MISS_LINE = '2026-10-13T09:50:24.869Z [extension] page kind: none (model memo: not in the row\'s kept answers (an offline replay never asks the model); the nearest kept ask differs in: use), the structure rule decides {"shape":"x"}';

test('2: ANY ask the capture has no kept answer for makes the row NOT MEASURED, the step and the differing part named; the top line counts the reasons', () => {
  assert.deepEqual(missesIn(MISS_LINE), [{what: 'page kind', parts: 'use'}]);
  const dir = capture(tmp(), {kept: 16});
  assert.equal(measuredRow(dir, {appLog: kind('01', 'form'), misses: 0}).measured, true);
  const one = measuredRow(dir, {appLog: MISS_LINE, misses: 1});
  assert.equal(one.measured, false, 'one miss of 16 is enough: it decided the page kind');
  assert.match(one.why, /1 ask with no kept answer \(page kind: use differs\): not measured/);
  const other = measuredRow(capture(tmp(), {row: 'Recruitee'}), {appLog: MISS_LINE, misses: 1});
  const tables = tablesOf([one, other], 'offline');
  assert.equal(tables.rows, 0);
  const lines = tableLines(tables, 'x');
  assert.equal(lines[0], '[x] 0 rows measured, 2 NOT MEASURED (page kind: use differs x2)');
  assert.match(lines.join('\n'), /not measured: Lever: single page/);
  const counted = measuredRow(dir, {appLog: '', misses: 1});   // a miss counted by the replay whose line was cut: still not measured
  assert.equal(counted.measured, false);
  assert.equal(measuredRow(dir, {error: 'the browser closed'}).measured, false);   // a failed replay is not measured either
});

test('3: a press no capture saw is unseen, never worked or failed', () => {
  const live = acted('01', 'no_route', 'worked');
  const replay = [acted('01', 'no_route', 'worked'), acted('05', 'no_route', 'worked'), acted('07', 'silent', 'failed')].join('\n');
  assert.deepEqual(pressesOf(replay, live).map(press => press.effect), ['worked', 'unseen', 'unseen']);
  const dir = capture(tmp(), {log: live});
  const tables = tablesOf([measuredRow(dir, {appLog: replay, misses: 0})], 'offline');
  assert.deepEqual(tables.acted, {acted: 3, worked: 1, failed: 0, unseen: 2});
});

test('the live and the offline side read an app log the same way (the positive control compares like with like)', () => {
  const log = [kind('01', 'posting'), kind('03', 'form')].join('\n');
  const dir = capture(tmp(), {log});
  const row = measuredRow(dir, {appLog: log, misses: 0});
  assert.deepEqual(tablesOf([row], 'offline').perRow, tablesOf([row], 'live').perRow);
  assert.equal(readingOf(log, 'https://jobs.example.org/a').result.reached, 'form');
});

test('the library gives each row\'s newest capture of the days asked (a live visit refreshes the row)', () => {
  const root = tmp();
  capture(root, {day: '2026-10-12', name: 'lever-090000'});
  const newest = capture(root, {day: '2026-10-13', name: 'lever-060000'});
  const other = capture(root, {day: '2026-10-13', name: 'recruitee-070000', row: 'Recruitee: one-page form'});
  assert.deepEqual(capturesOf(root, {days: 2, today: '2026-10-13'}).sort(), [newest, other].sort());
  assert.equal(capturesOf(root, {days: 2, today: '2026-10-13', every: true}).length, 3);
  assert.deepEqual(capturesOf(root, {days: 1, today: '2026-10-14'}), []);
});

test('measure replays one row at a time: side by side, the app\'s miss lines (no host) left a row\'s log and its misses went uncounted', () => {
  const source = fs.readFileSync(new URL('../../measure.mjs', import.meta.url), 'utf8');
  assert.match(source, /replayRows\(dirs, \{[^\n]*tabs: 1\}\)/);
});

// The class, not the case (cc, 13 Oct 2026: a grown-applicant capture replayed as the thin one): EVERY recorded run setting is either set for the replay or checked, and a capture
// missing any one is not measured. A new setting in RUN_SETTINGS is covered here without a new test.
test('every recorded run setting: replayed as recorded, and a capture missing it is not measured, never guessed', () => {
  const full = {settings: {applicant: 'grown', model: 'claude-haiku-5-5', engine: 'api', store: 'sqlite'}};
  assert.deepEqual(Object.keys(full.settings).sort(), Object.keys(RUN_SETTINGS).sort(), 'the test names every setting');
  const ok = settingsOf(full);
  assert.equal(ok.why, '');
  for (const [name, setting] of Object.entries(RUN_SETTINGS)) {
    if (setting.replayEnv) assert.equal(ok.env[setting.replayEnv], full.settings[name], `${name} is set for the replay`);
    const {[name]: _gone, ...rest} = full.settings;
    const missing = settingsOf({settings: rest});
    assert.equal(missing.why, name === 'applicant' ? 'applicant not recorded' : `${name} not recorded`);
  }
  assert.equal(settingsOf({settings: {...full.settings, model: 'default'}}).env.JOBADABRA_MODEL_OVERRIDE, '', 'the default model: the variable is cleared');
  assert.match(settingsOf({settings: {...full.settings, store: 'notion'}}).why, /store notion is not replayed offline/);
  const {applicant: _applicant, ...noApplicant} = full.settings;
  assert.equal(settingsOf({settings: noApplicant, result: {applicant: 'grown'}}).env.JP_APPLICANT, 'grown', 'an older capture kept its applicant in its result');
  const refused = unreplayedRow(capture(tmp()), 'engine not recorded');
  assert.equal(refused.measured, false);
  assert.equal(tablesOf([refused], 'offline').reasons['engine not recorded'], 1);
});

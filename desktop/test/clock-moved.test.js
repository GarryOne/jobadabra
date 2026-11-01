// Guard for tools/clock-moved.mjs, the nightly time-bomb finder (owner via a8, 1 Nov 2026). The positive control runs real fixture files through the real runner with a stand-in for faketime
// (a Date shim, since libfaketime is Linux-only): a file that passes today and fails at +1 d / +7 d is reported, a file red today is not, and a faketime that does not move the clock is an error, never "nothing found".
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {execute, filesOf, findTimeBombs, firstFailure, pool, probe, reportText} from '../../tools/clock-moved.mjs';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/clock-moved.mjs');
// Why (1 Nov 2026, #2823 red on Windows): the faketime stand-in is a /bin/sh script, so the tests that run through it skip on Windows; the rest of this file runs everywhere.
const NEEDS_SH = process.platform === 'win32' && 'the faketime stand-in is a /bin/sh script';
const FIXTURE_AREA = {name: 'fixture', cwd: '.', dir: 'test', match: /\.test\.js$/, command: file => ['node', file]};

// A stand-in for `faketime -f +Nd <cmd>`: the same arguments, a Date that reads N days ahead. `moves=false` is a faketime that runs the command but leaves the clock alone.
function standIn(dir, moves = true) {
  const shim = path.join(dir, 'shift.mjs');
  fs.writeFileSync(shim, `const off = Number(process.env.FAKE_DAYS || 0) * 86400000, Real = Date;
globalThis.Date = class extends Real { constructor(...a) { a.length ? super(...a) : super(Real.now() + off); } static now() { return Real.now() + off; } };\n`);
  const bin = path.join(dir, 'fake-faketime');
  fs.writeFileSync(bin, `#!/bin/sh\ndays=\${2#+}; days=\${days%d}; shift 2\n${moves ? `FAKE_DAYS=$days NODE_OPTIONS="--import=${shim}" ` : ''}exec "$@"\n`, {mode: 0o755});
  return bin;
}

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-moved-test-'));
  fs.mkdirSync(path.join(root, 'test'));
  const stamp = Date.now();   // clock: relative the fixture files are written with today's reading on purpose: they pass now and age out
  const write = (name, body) => fs.writeFileSync(path.join(root, 'test', name), body);
  write('fine.test.js', "require('node:assert/strict').ok(true);\n");
  write('bomb-one-day.test.js', `const assert = require('node:assert/strict');\nassert.ok(Date.now() - ${stamp} < 12 * 3600 * 1000, 'a fixed stamp aged past half a day'); // clock: relative the fixture is the bomb\n`);
  write('bomb-seven-days.test.js', `const assert = require('node:assert/strict');\nassert.ok(new Date().getTime() - ${stamp} < 3 * 86400000, 'a fixed stamp aged past three days'); // clock: relative the fixture is the bomb\n`);
  write('red-today.test.js', "throw new Error('red on the real clock too');\n");
  return {root, dir: root};
}

test('a file green today and red with the clock moved is reported at the smallest shift that breaks it; a file red today is not', {skip: NEEDS_SH}, async t => {
  const {root} = tree();
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  process.env.CLOCK_MOVED_FAKETIME = standIn(root);
  t.after(() => delete process.env.CLOCK_MOVED_FAKETIME);
  const result = await findTimeBombs({root, areas: [FIXTURE_AREA], concurrency: 2});
  assert.deepEqual(result.bombs.map(b => [b.file, b.days]).sort(), [['test/bomb-one-day.test.js', 1], ['test/bomb-seven-days.test.js', 7]]);
  assert.match(result.bombs.find(b => b.days === 1).why, /aged past half a day/, 'the first failure line is named');
  assert.equal(result.redToday, 1, 'the file red on the real clock is counted and left out');
  assert.equal(result.judged, 3);
  assert.deepEqual(result.unstable, []);
  const text = reportText(result);
  assert.match(text, /`test\/bomb-one-day\.test\.js` · \+1 d · /);
  assert.match(text, /`test\/bomb-seven-days\.test\.js` · \+7 d · /);
  assert.doesNotMatch(text, /red-today/);
});

test('nothing red when moved says so in one line; the same line is never printed when nothing was measured', {skip: NEEDS_SH}, async t => {
  const {root} = tree();
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const name of ['bomb-one-day', 'bomb-seven-days', 'red-today']) fs.rmSync(path.join(root, 'test', `${name}.test.js`));
  process.env.CLOCK_MOVED_FAKETIME = standIn(root);
  t.after(() => delete process.env.CLOCK_MOVED_FAKETIME);
  assert.match(reportText(await findTimeBombs({root, areas: [FIXTURE_AREA], concurrency: 2})), /^✅ No test depends on today's date\./);
  const script = (extra) => spawnSync(process.execPath, [TOOL, '--area', 'e2e', ...extra], {env: {...process.env, CLOCK_MOVED_FAKETIME: path.join(root, 'missing-faketime')}, encoding: 'utf8'});
  const missing = script([]);
  assert.equal(missing.status, 2, 'no faketime: a non-zero exit');
  assert.match(missing.stderr, /faketime did not run node/);
  assert.doesNotMatch(missing.stdout + missing.stderr, /No test depends on today's date/);
});

test('a faketime that runs but does not move the clock is caught by the probe before any test runs', {skip: NEEDS_SH}, async t => {
  const {root} = tree();
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  process.env.CLOCK_MOVED_FAKETIME = standIn(root, false);
  t.after(() => delete process.env.CLOCK_MOVED_FAKETIME);
  await assert.rejects(probe({areas: [FIXTURE_AREA], cwd: root}), /the clock did not move 1 d/);
  process.env.CLOCK_MOVED_FAKETIME = standIn(root, true);
  await probe({areas: [FIXTURE_AREA], cwd: root});
});

test('a file that fails once moved but not again is unstable, not a time bomb', async () => {
  const calls = new Map();
  const areas = [{name: 'a', cwd: '.', dir: 'test', match: /\.test\.js$/, command: file => [file]}];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-moved-test-'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'test', 'flaky.test.js'), '');
  const run = async (argv, {days}) => {
    const n = (calls.get(days) || 0) + 1;
    calls.set(days, n);
    return days === 1 && n === 1 ? {code: 1, output: 'AssertionError: first time only'} : {code: 0, output: ''};
  };
  const result = await findTimeBombs({root, areas, shifts: [1], run, concurrency: 1});
  fs.rmSync(root, {recursive: true, force: true});
  assert.deepEqual(result.bombs, []);
  assert.equal(result.unstable.length, 1);
});

test('helpers: the first failure line, the pool order, the file lists the unit jobs run, and a timeout is a failure', async () => {
  assert.equal(firstFailure({code: 1, output: 'not ok 1 - x\n  AssertionError [ERR_ASSERTION]: expected 1\n'}), 'AssertionError [ERR_ASSERTION]: expected 1');
  assert.equal(firstFailure({code: 3, output: ''}), 'exit 3');
  assert.deepEqual(await pool([3, 1, 2], 2, async n => n * 2), [6, 2, 4]);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const names = {desktop: 'test/clock-moved.test.js', e2e: 'test/harness/night-pass.test.mjs', python: 'tests/test_unpinned_clock.py'};
  const {AREAS} = await import('../../tools/clock-moved.mjs');
  for (const area of AREAS) assert.ok(filesOf(root, area).includes(names[area.name].replace(/^tests?\//, area.dir + '/')), `${area.name} lists its test files`);
  const slow = await execute(['node', '-e', 'setTimeout(() => {}, 5000)'], {cwd: root, timeoutMs: 200});
  assert.notEqual(slow.code, 0);
});

test('the report names the file, the shift and the first failure; an empty night is one line', () => {
  const text = reportText({judged: 10, redToday: 2, bombs: [{area: 'e2e', file: 'desktop/e2e/test/x.test.mjs', days: 1, why: 'AssertionError: stale'}], unstable: [], seconds: 5});
  assert.match(text, /- `desktop\/e2e\/test\/x\.test\.mjs` · \+1 d · AssertionError: stale/);
  assert.match(text, /10 test files judged \(2 red on today's clock left out/);
});

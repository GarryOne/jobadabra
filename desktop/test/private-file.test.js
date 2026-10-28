// Every private file the app writes ends up 0600, also when it already existed (Node's {mode} applies only to a new file: 13 Oct 2026, the test app's job-site
// passwords were written 0644). The class: any writeFileSync with a 0600 mode must go through lib/private-file.js writePrivate.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {flushPending, onChange, retryPrivate, timing, writePrivate} from '../lib/private-file.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? (entry.name === 'node_modules' || entry.name === 'test' ? [] : sources(path.join(dir, entry.name))) : /\.m?js$/.test(entry.name) ? [path.join(dir, entry.name)] : []));

test('an existing world-readable file becomes 0600', {skip: process.platform === 'win32'}, () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-private-')), 'secrets.json');
  fs.writeFileSync(file, '{}', {mode: 0o644});
  writePrivate(file, '{"a":1}');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}');
});

test('no file under desktop/lib or desktop/e2e/lib writes a 0600 file without writePrivate', () => {
  const offenders = [path.join(here, '..', 'lib'), path.join(here, '..', 'e2e', 'lib')].flatMap(sources).filter(file => !file.endsWith('private-file.js'))
    .flatMap(file => fs.readFileSync(file, 'utf8').split('\n').map((line, at) => [file, at + 1, line])).filter(([, , line]) => /writeFileSync\(.*0o600/.test(line))
    .map(([file, at]) => `${path.relative(path.join(here, '..'), file).replace(/\\/g, '/')}:${at}`);
  assert.deepEqual(offenders, [], 'use writePrivate (lib/private-file.js): {mode} alone leaves an existing file readable by others');
});

// 27 Oct 2026 (e2e red on #2266): writeFileSync emptied settings.json before writing it, and a store call reading it then threw "Unexpected end of JSON input".
for (const name of ['settings.json', 'secrets.json']) {
  test(`a reader polling ${name} while the app saves it never sees it empty or cut`, async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-private-')), name);
    const value = n => JSON.stringify({n, pad: 'x'.repeat(256 * 1024)});
    writePrivate(file, value(0));
    const reader = spawn(process.execPath, ['-e', `const fs = require('fs'); let bad = 0, reads = 0; const end = Date.now() + 1500;
      while (Date.now() < end) { reads++; try { JSON.parse(fs.readFileSync(${JSON.stringify(file)}, 'utf8')); } catch { bad++; } }
      process.stdout.write(JSON.stringify({bad, reads}));`]);
    let out = '';
    reader.stdout.on('data', chunk => { out += chunk; });
    await new Promise(done => reader.on('spawn', done));
    for (let n = 1, end = Date.now() + 1200; Date.now() < end; n++) writePrivate(file, value(n));
    await new Promise(done => reader.on('exit', done));
    const {bad, reads} = JSON.parse(out);
    assert.ok(reads > 50, `the reader read ${reads} times`);
    assert.equal(bad, 0, `${bad} of ${reads} reads found ${name} empty or cut`);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [name], 'no temp file is left behind');
  });
}

test('a write that fails leaves the old file whole and no temp file', {skip: process.platform === 'win32'}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-private-'));
  const file = path.join(dir, 'settings.json');
  writePrivate(file, '{"kept":true}');
  fs.mkdirSync(path.join(dir, 'settings.json.dir'));
  assert.throws(() => writePrivate(path.join(dir, 'settings.json.dir'), '{}'));   // a rename over a folder fails
  assert.equal(fs.readFileSync(file, 'utf8'), '{"kept":true}');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['settings.json', 'settings.json.dir']);
});

// #2279, gitar-bot: a save killed before its rename leaves the private content in <file>.<pid>-<n>.private-tmp. The next save removes it once that process is gone,
// keeps a live process's temp (it may be renaming now), and an export never carries one.
test('a killed save leaves no temp that outlives its process or goes into an export', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-private-'));
  const file = path.join(dir, 'secrets.json');
  const gone = spawn(process.execPath, ['-e', '']);
  await new Promise(done => gone.on('exit', done));
  const dead = `secrets.json.${gone.pid}-1.private-tmp`, live = `secrets.json.${process.ppid}-1.private-tmp`;
  for (const name of [dead, live]) fs.writeFileSync(path.join(dir, name), '{"key":"half"}');
  writePrivate(file, '{"key":"whole"}');
  assert.deepEqual(fs.readdirSync(dir).sort(), [live, 'secrets.json'].sort());
  const {LEFT_OUT} = await import('../lib/reset.js');
  assert.ok(LEFT_OUT.some(rule => rule.test(live)), 'the export leaves temp files out');
});

// #2279, gitar-bot: a leftover that cannot be removed (EPERM/EBUSY on Windows) must not stop the save that found it.
test('a leftover that cannot be removed does not stop the save', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-private-'));
  const file = path.join(dir, 'settings.json');
  const gone = spawn(process.execPath, ['-e', '']);
  await new Promise(done => gone.on('exit', done));
  const leftover = path.join(dir, `settings.json.${gone.pid}-1.private-tmp`);
  fs.writeFileSync(leftover, 'half');
  const rmSync = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (String(target).endsWith('.private-tmp') && String(target).includes(`.${gone.pid}-`)) throw Object.assign(new Error('locked'), {code: 'EPERM'});
    return rmSync(target, options);
  };
  try { writePrivate(file, '{"saved":true}'); } finally { fs.rmSync = rmSync; }
  assert.equal(fs.readFileSync(file, 'utf8'), '{"saved":true}');
  assert.ok(fs.existsSync(leftover), 'the removal really failed (the mock took effect)');
});

// Design (28 Oct 2026, owner "Save shortly after"; #2351 Windows desktop: file held 1500 ms -> EPERM after 1509 ms). A file Windows holds longer than the brief retry is
// saved shortly after: saved / waiting / could not save, one owner (lib/private-file.js). These play "held" with a rename that fails until released, so they do not depend on
// the runner's speed or platform; the last test is the plain 1.5 s hold that bites on Windows CI.
const dirOf = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-private-'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function held(run) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform'), renameSync = fs.renameSync, saved = {...timing};
  const hold = {on: false};
  Object.defineProperty(process, 'platform', {value: 'win32'});
  fs.renameSync = (from, to) => { if (hold.on) throw Object.assign(new Error('held'), {code: 'EPERM'}); return renameSync(from, to); };
  Object.assign(timing, {briefTries: 3, briefPauseMs: 1, retryMs: 20, giveUpMs: 400});
  try { await run(hold); } finally { Object.defineProperty(process, 'platform', platform); fs.renameSync = renameSync; Object.assign(timing, saved); }
}

test('a file held past the brief retry is saved shortly after, old file whole meanwhile, no temp left', () => held(async hold => {
  const file = path.join(dirOf(), 'settings.json');
  hold.on = false; writePrivate(file, '{"v":0}'); hold.on = true;
  const states = [], off = onChange(event => states.push(event.state));
  assert.equal(writePrivate(file, '{"v":1}'), 'waiting');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":0}', 'the old file stays whole while waiting');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'], 'no temp file while waiting');
  hold.on = false;
  await sleep(150);
  off();
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
  assert.deepEqual(states, ['waiting', 'saved']);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
}));

test('while waiting the newest value wins, an older one is never written after it', () => held(async hold => {
  const file = path.join(dirOf(), 'settings.json');
  hold.on = false; writePrivate(file, '{"v":0}'); hold.on = true;
  writePrivate(file, '{"v":1}'); writePrivate(file, '{"v":2}'); writePrivate(file, '{"v":3}');
  hold.on = false;
  await sleep(150);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":3}');
}));

test('held too long: the person is told (could not save), Retry saves the newest value once the file is free', () => held(async hold => {
  const file = path.join(dirOf(), 'settings.json');
  hold.on = false; writePrivate(file, '{"v":0}'); hold.on = true;
  const states = [], off = onChange(event => states.push(event.state));
  writePrivate(file, '{"v":1}');
  await sleep(600);
  assert.deepEqual(states, ['waiting', 'failed']);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":0}');
  hold.on = false;
  assert.equal(retryPrivate(file), true);
  await sleep(100);
  off();
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
  assert.deepEqual(states, ['waiting', 'failed', 'waiting', 'saved']);
  assert.equal(retryPrivate(file), false, 'nothing waits any more');
}));

test('a save still waiting when the app quits is completed, or returned to be reported', () => held(async hold => {
  const [one, two] = [path.join(dirOf(), 'a.json'), path.join(dirOf(), 'b.json')];
  hold.on = false; writePrivate(one, '{"v":0}'); writePrivate(two, '{"v":0}'); hold.on = true;
  writePrivate(one, '{"v":1}'); writePrivate(two, '{"v":1}');
  hold.on = false;
  assert.deepEqual(flushPending(), [], 'the file is free at quit: both are saved');
  assert.equal(fs.readFileSync(one, 'utf8'), '{"v":1}'); assert.equal(fs.readFileSync(two, 'utf8'), '{"v":1}');
  hold.on = true; writePrivate(one, '{"v":3}');
  assert.deepEqual(flushPending(), [one], 'still held at quit: reported, not dropped');
  hold.on = false;
}));

// The plain case from #2351: a reader holds settings.json for 1.5 s (longer than the old 10 x 20 ms). On Windows the rename is refused for that long (EPERM after 1509 ms);
// the save must be reported saved or waiting, never thrown, and the newest value lands once the reader lets go.
test('a reader holding the file for 1.5 s does not make the save throw; the newest value lands after', async () => {
  const file = path.join(dirOf(), 'settings.json');
  writePrivate(file, '{"v":0}');
  const reader = spawn(process.execPath, ['-e', `const fs = require('fs'); const fd = fs.openSync(${JSON.stringify(file)}, 'r'); process.stdout.write('open');
    setTimeout(() => { fs.closeSync(fd); }, 1500);`]);
  await new Promise(done => reader.stdout.once('data', done));
  const saved = {...timing};
  timing.giveUpMs = 8000;
  try {
    assert.ok(['saved', 'waiting'].includes(writePrivate(file, '{"v":1}')));
    await new Promise(done => reader.on('exit', done));
    for (let i = 0; i < 40 && fs.readFileSync(file, 'utf8') !== '{"v":1}'; i++) await sleep(100);
  } finally { Object.assign(timing, saved); }
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

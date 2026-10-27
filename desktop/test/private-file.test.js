// Every private file the app writes ends up 0600, also when it already existed (Node's {mode} applies only to a new file: 13 Oct 2026, the test app's job-site
// passwords were written 0644). The class: any writeFileSync with a 0600 mode must go through lib/private-file.js writePrivate.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {writePrivate} from '../lib/private-file.js';

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

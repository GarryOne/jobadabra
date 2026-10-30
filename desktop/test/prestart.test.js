// Dev startup reports install failures and refuses shared node_modules before invoking npm.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const {scripts} = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const guard = 'check-install.mjs';
const installScripts = Object.entries(scripts).filter(([, command]) => /\bnpm\s+(?:install|ci)\b/.test(command));

function fixture(t, modules = 'missing') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prestart-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'scripts'));
  const source = path.join(desktop, 'scripts', guard);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dir, 'scripts', guard));
  if (modules === 'directory') fs.mkdirSync(path.join(dir, 'node_modules'));
  if (modules === 'linked' || modules === 'dangling') {
    const shared = path.join(dir, 'shared');
    if (modules === 'linked') fs.mkdirSync(shared);
    fs.symlinkSync(shared, path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  // npm is the external boundary: reproduce its silent/error log levels without installing anything.
  fs.writeFileSync(path.join(bin, 'npm-fake.cjs'), `
const fs = require('node:fs');
fs.writeFileSync('npm-called', JSON.stringify(process.argv.slice(2)));
if (!process.argv.some(arg => ['--silent', '-s', '--loglevel=silent'].includes(arg))) {
  console.error('npm error ENOTDIR: rename node_modules/node_modules');
}
process.exit(236);
`);
  fs.writeFileSync(path.join(bin, 'npm'), '#!/usr/bin/env node\nrequire("./npm-fake.cjs");\n', {mode: 0o755});
  fs.writeFileSync(path.join(bin, 'npm.cmd'), '@node "%~dp0npm-fake.cjs" %*\r\n');
  const env = {...process.env, PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter)};
  return {dir, run(command) {
    const win = process.platform === 'win32';
    const result = spawnSync(win ? 'cmd.exe' : 'sh', win ? ['/d', '/s', '/c', command] : ['-c', command], {
      cwd: dir, env, encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    return result;
  }};
}

test('prestart prints npm install errors and exits nonzero', t => {
  const {dir, run} = fixture(t);
  const result = run(scripts.prestart);
  assert.ok(fs.existsSync(path.join(dir, 'npm-called')), 'the fake install must be reached');
  assert.equal(result.status, 236);
  assert.match(result.stdout + result.stderr, /npm error ENOTDIR: rename node_modules\/node_modules/);
});

test('every lifecycle install refuses linked modules before npm runs', t => {
  assert.ok(installScripts.length, 'exercise at least the prestart install');
  for (const [name, command] of installScripts) {
    const {dir, run} = fixture(t, 'linked');
    const result = run(command);
    assert.ok(result.status > 0, name);
    assert.equal(fs.existsSync(path.join(dir, 'npm-called')), false, `${name} must stop before npm`);
    assert.match(result.stderr, /tools\/worktree\.sh own-modules desktop/);
    assert.equal(result.stderr.trim().split(/\r?\n/).length, 1, 'one actionable line');
    assert.ok(fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink());
    assert.deepEqual(fs.readdirSync(path.join(dir, 'shared')), [], 'shared modules stay untouched');
  }
});

test('prestart also refuses a dangling modules link before npm runs', t => {
  const {dir, run} = fixture(t, 'dangling');
  const result = run(scripts.prestart);
  assert.ok(result.status > 0);
  assert.equal(fs.existsSync(path.join(dir, 'npm-called')), false);
  assert.match(result.stderr, /tools\/worktree\.sh own-modules desktop/);
});

test('prestart allows an owned modules directory to reach npm', t => {
  const {dir, run} = fixture(t, 'directory');
  const result = run(scripts.prestart);
  assert.equal(result.status, 236, 'preserve the install failure status');
  assert.ok(fs.existsSync(path.join(dir, 'npm-called')));
});

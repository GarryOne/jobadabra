// The harness runs the Claude Code install itself, never a wrapper script a terminal put first on PATH (lib/real-claude.mjs; 11 Oct 2026: a terminal's `claude`
// added its session's settings to every `claude -p`, and the test app's form answers carried the owner's real name). A place that starts the app or `claude`
// without the guard fails the last test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {isWrapper, realClaude, refuseWrapper, withoutWrappers} from '../../lib/real-claude.mjs';

const E2E = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..');
const binDir = (name, head) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jp-claude-${name}-`));
  fs.writeFileSync(path.join(dir, 'claude'), head, {mode: 0o755});
  return dir;
};

test('a shell script is a wrapper; a native binary or a node script is the install', {skip: process.platform === 'win32' && 'POSIX only'}, () => {
  for (const head of ['#!/usr/bin/env bash\nexec claude "$@"', '#!/bin/sh\nexec x', '#!/bin/zsh\n', '#! /usr/bin/env  sh\n']) assert.equal(isWrapper(path.join(binDir('w', head), 'claude')), true, head);
  for (const head of [Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0]), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), '#!/usr/bin/env node\nrequire("./cli.js")']) assert.equal(isWrapper(path.join(binDir('r', head), 'claude')), false, String(head).slice(0, 20));
  assert.equal(isWrapper('/no/such/claude'), false);
});

test('withoutWrappers drops only the PATH folders whose claude is a wrapper; realClaude is then the install', {skip: process.platform === 'win32' && 'POSIX only'}, () => {
  const wrapper = binDir('w', '#!/usr/bin/env bash\n'), real = binDir('r', Buffer.from([0xcf, 0xfa, 0xed, 0xfe])), other = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-other-'));
  const env = withoutWrappers({PATH: [wrapper, other, real].join(path.delimiter), HOME: '/x'});
  assert.equal(env.PATH, [other, real].join(path.delimiter));
  assert.equal(env.HOME, '/x');
  assert.equal(realClaude(env), path.join(real, 'claude'));
  assert.equal(realClaude({PATH: wrapper}), '');
});

test('a saved Claude Code path that is a wrapper is refused before the app starts', {skip: process.platform === 'win32' && 'POSIX only'}, () => {
  assert.throws(() => refuseWrapper(path.join(binDir('w', '#!/bin/bash\n'), 'claude')), /wrapper/);
  assert.doesNotThrow(() => refuseWrapper(path.join(binDir('r', Buffer.from([0xcf, 0xfa])), 'claude')));
  assert.doesNotThrow(() => refuseWrapper(''));
});

// Every harness place that starts the app under test or `claude` itself, and the guard it uses. A new place (a launch, a spawn of claude) must be added here.
const SITES = ['lib/app.mjs', 'twin.mjs', 'lib/model.mjs', 'lib/engine.mjs', 'lib/ladder-score-path.mjs', 'lib/offline-guard.mjs'];
const STARTS = /electron\.launch\(|'\.bin', 'electron'|spawn\('claude'|execFileSync\('claude'|which\('claude'\)|binary = 'claude'|cliClient\(/;

test('every place that starts the app or claude goes through the guard', () => {
  const files = [...fs.readdirSync(E2E), ...fs.readdirSync(path.join(E2E, 'lib')).map(f => `lib/${f}`)].filter(f => f.endsWith('.mjs') && f !== 'lib/real-claude.mjs');
  const starters = files.filter(f => STARTS.test(fs.readFileSync(path.join(E2E, f), 'utf8')));
  assert.deepEqual(starters.filter(f => !SITES.includes(f)), [], 'a new place starts the app or claude: add it to SITES and use lib/real-claude.mjs');
  for (const site of SITES) assert.match(fs.readFileSync(path.join(E2E, site), 'utf8'), /real-claude\.mjs'/, `${site} does not use lib/real-claude.mjs`);
});

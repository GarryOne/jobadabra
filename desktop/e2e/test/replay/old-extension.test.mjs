// lib/old-extension.mjs: the extension before a fix, built from a commit, in a temp folder (row-to-case --old-commit).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {oldExtension} from '../../lib/old-extension.mjs';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-old-ext-test-'));
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {cwd: repo, encoding: 'utf8'});
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(repo, file)), {recursive: true}); fs.writeFileSync(path.join(repo, file), text); };
const commit = message => { git('add', '-A'); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD').trim(); };
git('init', '-q');
write('extension/fill.js', 'line1\nfill-before\nline3\n'); write('extension/manifest.json', '{"version":"1"}\n'); write('extension/other.js', 'other\n'); write('extension/fingerprint.json', '{"hash":"1"}\n');
commit('base');
write('extension/fill.js', 'line1\nfill-after\nline3\n'); write('extension/manifest.json', '{"version":"2"}\n'); write('extension/fingerprint.json', '{"hash":"2"}\n');
const fix = commit('the fix');
write('extension/other.js', 'other, changed later\n'); write('src/app.py', 'x = 1\n');
const later = commit('a later change');
write('src/app.py', 'x = 2\n');
const noExtension = commit('not the extension');

test('the fix is taken out; everything else (the manifest, later changes) stays as it is', () => {
  const old = oldExtension({repo, sha: fix});
  try {
    assert.equal(fs.readFileSync(path.join(old.extensionDir, 'fill.js'), 'utf8'), 'line1\nfill-before\nline3\n');
    assert.equal(fs.readFileSync(path.join(old.extensionDir, 'manifest.json'), 'utf8'), '{"version":"2"}\n', 'the version bump is not the behaviour');
    assert.equal(fs.readFileSync(path.join(old.extensionDir, 'other.js'), 'utf8'), 'other, changed later\n');
    assert.equal(fs.readFileSync(path.join(old.extensionDir, 'fingerprint.json'), 'utf8'), '{"hash":"2"}\n', 'nor its hash');
    assert.equal(fs.existsSync(path.join(old.dir, '.index')), false);
  } finally { old.remove(); }
  assert.equal(fs.existsSync(old.dir), false);
});

test('a commit with no extension change, a short or unknown hash, and a change that no longer reverts says so and falls back to the tree before it', () => {
  assert.throws(() => oldExtension({repo, sha: noExtension}), /changes nothing under extension/);
  assert.throws(() => oldExtension({repo, sha: 'zz'}), /wants a commit hash/);
  assert.throws(() => oldExtension({repo, sha: 'deadbeef'}), /no such commit/);
  write('extension/fill.js', 'rewritten\n'); commit('rewrite');
  const fell = oldExtension({repo, sha: fix});
  try {
    assert.match(fell.note, /no longer revert cleanly.*the extension at .*\^ instead.*control is weaker/);
    assert.equal(fs.readFileSync(path.join(fell.extensionDir, 'fill.js'), 'utf8'), 'line1\nfill-before\nline3\n', 'the tree just before the fix');
    assert.equal(fs.existsSync(path.join(fell.extensionDir, 'other.js')), true);
  } finally { fell.remove(); }
  assert.ok(later);
});

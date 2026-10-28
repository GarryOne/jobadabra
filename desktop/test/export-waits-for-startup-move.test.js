// lib/reset.js exportTo packs after the app's start-up move into the store is over (main's settings e2e, 28 Oct 2026: the move dropped profile.md under a running tar:
// "Export failed: tar failed (2)", and an archive without profile.md). A person pressing Export (or a due automatic backup) in the seconds the move runs met the same.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as reset from '../lib/reset.js';
import * as startupMove from '../lib/startup-move.js';
import {tar} from '../lib/tar.js';   // the system tar on Windows: a Git GNU tar there reads "D:\\..." as a host (#2347 first CI)

test('an export started while the start-up move runs packs the folder as the move leaves it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-startup-move-')), file = path.join(os.tmpdir(), `jp-startup-move-${process.pid}.tar.gz`);
  fs.writeFileSync(path.join(dir, 'profile.md'), '# fictional profile\n');
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'stays\n');
  let over = false;
  startupMove.track(new Promise(resolve => setTimeout(() => { fs.rmSync(path.join(dir, 'profile.md')); over = true; resolve(); }, 400)));   // the move drops the local copy, then ends
  await reset.exportTo(dir, file, {version: 'test'});
  assert.equal(over, true, 'the export waited for the move');
  const held = spawnSync(tar(), ['-tzf', file], {encoding: 'utf8'}).stdout.split(/\r?\n/).map(name => name.replace(/^\.\//, ''));
  assert.ok(held.includes('keep.txt'), 'the folder went in');
  assert.equal(held.includes('profile.md'), false, 'the archive matches the folder after the move: no file that was dropped under the pack');
  fs.rmSync(dir, {recursive: true, force: true}); fs.rmSync(file, {force: true});
});

test('no start-up move, or one that failed, never holds an export', async () => {
  startupMove.track(Promise.reject(new Error('move failed')));
  await startupMove.settled();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-startup-move-')), file = path.join(os.tmpdir(), `jp-startup-move-b-${process.pid}.tar.gz`);
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'x\n');
  await reset.exportTo(dir, file, {version: 'test'});
  assert.ok(fs.existsSync(file));
  fs.rmSync(dir, {recursive: true, force: true}); fs.rmSync(file, {force: true});
});

// Guard for lib/staged-worker.mjs: a live or smoke run never uses a stale desktop/shared/app-core (11 Oct 2026: a worker prompt edit ran live on the staged copy from before it).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {stagedWorkerDiffers, ensureStagedWorker} from '../../lib/staged-worker.mjs';

const tree = files => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-worker-')); for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text); return dir; };

test('a staged copy equal to app-core/src is fine; an edited, missing or extra file is stale', () => {
  const src = tree({'a.js': 'one', 'b.js': 'two'});
  assert.deepEqual(stagedWorkerDiffers(src, tree({'a.js': 'one', 'b.js': 'two'})), []);
  assert.deepEqual(stagedWorkerDiffers(src, tree({'a.js': 'one', 'b.js': 'CHANGED'})), ['b.js']);   // the deliberate break: a stale copy is caught
  assert.deepEqual(stagedWorkerDiffers(src, tree({'a.js': 'one'})), ['b.js']);
  assert.deepEqual(stagedWorkerDiffers(src, tree({'a.js': 'one', 'b.js': 'two', 'c.js': 'old'})), ['c.js']);
});

test('a stale copy is re-staged once, with one line saying so; a fresh one runs nothing', () => {
  const src = tree({'a.js': 'one'}), staged = tree({'a.js': 'stale'}), said = [];
  let runs = 0;
  const stage = () => { runs++; fs.writeFileSync(path.join(staged, 'a.js'), 'one'); };
  assert.equal(ensureStagedWorker({src, staged, stage, say: line => said.push(line)}), true);
  assert.equal(runs, 1);
  assert.equal(said.length, 1);
  assert.match(said[0], /stale \(a\.js\).*re-staged/);
  assert.equal(ensureStagedWorker({src, staged, stage, say: line => said.push(line)}), false);
  assert.equal(runs, 1);
  assert.throws(() => ensureStagedWorker({src, staged: tree({'a.js': 'x'}), stage: () => {}, say: () => {}}), /still differs/);   // staging that does not fix it refuses
});

test('the live row and the smoke start both check the staged worker first', () => {
  for (const file of ['../../lib/live-row.mjs', '../../record-sites.mjs']) assert.match(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), /ensureStagedWorker\(/, file);
});

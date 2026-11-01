// lib/run-artifacts.mjs: two runs at once get different artifact folders; a memo write is atomic; record-sites.mjs and apply-live.mjs use them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {runArtifacts, writeAtomic} from '../../lib/run-artifacts.mjs';

test('every call gives a new, empty folder', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ra-test-'));
  const one = runArtifacts(base), two = runArtifacts(base);
  assert.notEqual(one, two);
  for (const dir of [one, two]) assert.deepEqual(fs.readdirSync(dir), []);
});

test('writeAtomic replaces the file whole and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ra-test-')), file = path.join(dir, 'memo.json');
  writeAtomic(file, '{"a":1}'); writeAtomic(file, '{"b":2}');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"b":2}');
  assert.deepEqual(fs.readdirSync(dir), ['memo.json']);
});

test('the smoke run gives each live run its own artifacts folder, and the live memo is written atomically', () => {
  const smoke = fs.readFileSync(new URL('../../record-sites.mjs', import.meta.url), 'utf8'), live = fs.readFileSync(new URL('../../lib/apply-live.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /env: \{\.\.\.(?:process\.env|poolEnv\(\)), E2E_ARTIFACTS: runArtifacts\(\)/);   // poolEnv(): the pool's own environment, since 155a462
  assert.match(live, /writeAtomic\(memo, JSON\.stringify\(kept\)\)/);
});

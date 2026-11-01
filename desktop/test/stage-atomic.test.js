// Staging (scripts/stage.mjs) never leaves shared/ half-built for a reader in the same worktree: it builds into its own folder and swaps it in
// (11 Oct 2026: the Stop hook re-staged while ship.sh's push gate ran its tests there; they failed in 0 s on a half-deleted shared/).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(desktop, 'scripts', 'stage.mjs'), 'utf8');

test('a full staging builds elsewhere and swaps shared/ in with renames, never deleting it first', () => {
  assert.doesNotMatch(script, /rmSync\(path\.join\(desktop, 'shared'\)/, 'shared/ must not be deleted before the new copy is complete');
  assert.match(script, /\.shared-staging-\$\{process\.pid\}/);
  assert.match(script, /fs\.renameSync\(out, shared\)/);
});

// Why (29 Oct 2026): this test used to stage over the live desktop/shared while other test files in the same run imported it; a load in the middle of the
// copy found a file missing or empty and a test such as stalled-press-wired.test.js failed with no text (desktop jobs 123231146287, 123402443226, run 40859572591).
// It stages into its own folder, and no test file may run stage.mjs onto the shared one.
test('after a staging, the folder is complete, no temporary folder is left behind, and the live shared/ is not rewritten', () => {
  const live = path.join(desktop, 'shared', 'app-core', 'extension.js');
  const before = fs.existsSync(live) ? fs.statSync(live) : null;
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-atomic-'));
  try {
    execFileSync('node', ['scripts/stage.mjs', '--files-only', '--into', into], {cwd: desktop, stdio: 'ignore'});
    for (const file of ['recipe-schema.js', 'alias-schema.js', 'ladder-core.js', 'app-core']) assert.ok(fs.existsSync(path.join(into, file)), file);
  } finally { fs.rmSync(into, {recursive: true, force: true}); }
  assert.deepEqual(fs.readdirSync(desktop).filter(name => /^\.shared-staging-|^shared\.old-/.test(name)), []);
  if (before) {
    const after = fs.statSync(live);
    assert.deepEqual([after.ino, after.mtimeMs], [before.ino, before.mtimeMs], 'staging must not touch the shared/ other test files import');
  }
});

test('no test file runs stage.mjs onto the live shared/ (a run in the middle of other tests breaks their imports)', () => {
  const offenders = fs.readdirSync(path.join(desktop, 'test')).filter(name => /\.test\.m?js$/.test(name) && name !== 'stage-atomic.test.js')
    .filter(name => { const text = fs.readFileSync(path.join(desktop, 'test', name), 'utf8'); return /stage\.mjs/.test(text) && !/--into/.test(text); });
  assert.deepEqual(offenders, []);
});

// Keep the harness from growing unseen: lines of harness code stay at or under a committed number, and a shrink lowers it (JOB-48).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const excluded = new Set(['test', 'recorded', 'fixtures', 'node_modules']);
// Invariant: count only non-test .mjs files, without following directory symlinks.
function harnessFiles(folder) {
  return fs.readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) return excluded.has(entry.name) ? [] : harnessFiles(file);
    return entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs') ? [file] : [];
  });
}

const root = fileURLToPath(new URL('../', import.meta.url));
const lines = file => (fs.readFileSync(file, 'utf8').match(/\n/g) || []).length;
const files = harnessFiles(root);
const measured = files.reduce((sum, file) => sum + lines(file), 0);
const baseline = JSON.parse(fs.readFileSync(new URL('./harness-size.json', import.meta.url), 'utf8'));
const counts = `harness lines=${measured} (baseline ${baseline.harnessLines}), files=${files.length}, lib modules=${harnessFiles(path.join(root, 'lib')).length} (target 283)`;
const guidance = 'Read docs/superpowers/specs/2026-10-28-e2e-reliability-design.md row 29.';

// Why (30 Oct 2026, bb 2/9, JOB-48): three "+1 file" bumps in a day measured an asked-for fold or split as growth; lines measure the work. The test reads the PR's merged result (CI checks out the merge commit), so two PRs that each stay under the baseline but together exceed it still fail here.
test('harness lines stay at or under the harness-size.json ratchet', () => {
  assert.ok(measured <= baseline.harnessLines, `${counts}; growth needs "Harness-grow: <why>" in a commit message and harnessLines raised to ${measured} (tools/e2e-reliability-check.mjs checks the trailer). ${guidance}`);
});

test('a shrink lowers the ratchet, so the freed lines cannot be spent unseen', () => {
  assert.ok(measured >= baseline.harnessLines - baseline.slack, `${counts}; lower harnessLines in harness-size.json to ${measured} (a shrink of more than ${baseline.slack} lines must be kept). ${guidance}`);
});

// Why (30 Oct 2026, Gitar on #2554): a PR runs this test only when a folder reader in test-sets.json reaches its files, so a counted folder with no reader lets growth through unchecked until the daily run.
test('every folder the ratchet counts has a reader that runs it', () => {
  const sets = JSON.parse(fs.readFileSync(new URL('../test-sets.json', import.meta.url), 'utf8'));
  const folders = fs.readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory() && !excluded.has(entry.name) && harnessFiles(path.join(root, entry.name)).length).map(entry => `${entry.name}/`);
  const unread = ['./', ...folders].filter(folder => !sets.folderReaders?.[folder]?.includes('harness-size.test.mjs'));
  assert.deepEqual(unread, [], 'add each folder to "folderReaders" in desktop/e2e/test-sets.json with harness-size.test.mjs, so a PR that grows it runs the ratchet');
});

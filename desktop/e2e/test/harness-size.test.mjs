// Keep every harness shrink permanent by requiring exact committed file counts.
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
const measured = {libModules: harnessFiles(path.join(root, 'lib')).length, harnessFiles: harnessFiles(root).length};
const baseline = JSON.parse(fs.readFileSync(new URL('./harness-size.json', import.meta.url), 'utf8'));
const counts = `libModules=${measured.libModules} (baseline ${baseline.libModules}), harnessFiles=${measured.harnessFiles} (baseline ${baseline.harnessFiles})`;
const guidance = 'Read docs/superpowers/specs/2026-10-28-e2e-reliability-design.md row 29.';

for (const key of ['libModules', 'harnessFiles']) test(`${key} matches the harness-size.json ratchet`, () => {
  const action = measured[key] < baseline[key]
    ? `lower the number in harness-size.json to ${measured[key]} (${key})`
    : `shrink ${key} back to ${baseline[key]}; the ratchet only moves down`;
  assert.equal(measured[key], baseline[key], `${counts}; ${action}. ${guidance}`);
});

// Why (30 Oct 2026, Gitar on #2554): a PR runs this test only when a folder reader in test-sets.json reaches its files, so a counted folder with no reader lets growth through unchecked until the daily run.
test('every folder the ratchet counts has a reader that runs it', () => {
  const sets = JSON.parse(fs.readFileSync(new URL('../test-sets.json', import.meta.url), 'utf8'));
  const folders = fs.readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory() && !excluded.has(entry.name) && harnessFiles(path.join(root, entry.name)).length).map(entry => `${entry.name}/`);
  const unread = ['./', ...folders].filter(folder => !sets.folderReaders?.[folder]?.includes('harness-size.test.mjs'));
  assert.deepEqual(unread, [], 'add each folder to "folderReaders" in desktop/e2e/test-sets.json with harness-size.test.mjs, so a PR that grows it runs the ratchet');
});

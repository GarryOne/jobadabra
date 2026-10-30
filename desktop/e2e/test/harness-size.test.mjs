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

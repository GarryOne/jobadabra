// Fails when desktop/ names the app's data folder or Keychain item with a literal instead of LEGACY_NAME (the 24 Oct 2026 rename changed one in the twin's token reader).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', 'out', 'test', 'recorded', 'fixtures']);
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(m?js|cjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
  }
})(ROOT);

const IDENTITY = 'lib/app-identity.js';
const NAME = /['"`](Job Pilotto|Jobadabra)\b[^'"`]*['"`]/;
const IDENTITY_USE = /setName\(|['"]userData['"]|Safe Storage/;
const FOLDER_USE = /Application Support|APPDATA/;
// Files that still spell the old data folder as a literal (the folder keeps that name until its own migration); this list may only shrink.
const OLD_FOLDER_LITERALS = new Set(['e2e/twin-drive.mjs']);   // the twin's own "Job Pilotto (live test)" folder

const lines = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel === IDENTITY) continue;
  fs.readFileSync(file, 'utf8').split('\n').forEach((text, i) => lines.push({rel, n: i + 1, text}));
}

test('setName / userData / "Safe Storage" take LEGACY_NAME, never a name literal', () => {
  const bad = lines.filter(l => IDENTITY_USE.test(l.text) && NAME.test(l.text.replace(/\/\/.*$/, ''))).map(l => `${l.rel}:${l.n}`);
  assert.deepEqual(bad, []);
});

test('a data-folder path never spells the new name, and the old name only where listed', () => {
  const folder = lines.filter(l => FOLDER_USE.test(l.text) && NAME.test(l.text.replace(/\/\/.*$/, '')));
  assert.deepEqual(folder.filter(l => /Jobadabra/.test(l.text)).map(l => `${l.rel}:${l.n}`), []);
  const unlisted = [...new Set(folder.filter(l => !OLD_FOLDER_LITERALS.has(l.rel)).map(l => l.rel))];
  assert.deepEqual(unlisted, [], 'use LEGACY_NAME from lib/app-identity.js');
  const stale = [...OLD_FOLDER_LITERALS].filter(rel => !folder.some(l => l.rel === rel));
  assert.deepEqual(stale, [], 'no longer a literal: drop it from the list');
});

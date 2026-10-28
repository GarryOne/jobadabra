// The readers table the website shows (docs/about-you-readers.json) is the app's own READERS, exported: a reader is "live" there only when its bundle really reaches
// its step, and a cell never claims a part the reader does not take (owner via the coordinator, 28 Oct 2026: live only, nothing claimed before it works). No AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {FILE, text} from '../../tools/about-you-readers.mjs';
import {LIVE, PAGES, PARTS, READERS, readersTable} from '../lib/about-you.js';

test('the exported JSON is the app\'s READERS: run node tools/about-you-readers.mjs when this fails', () => {
  assert.equal(fs.readFileSync(FILE, 'utf8'), text());
});

test('every reader and part has a name; a cell is claimed only for a live reader, and only for a part it takes', () => {
  const table = readersTable();
  assert.deepEqual(table.parts.map(part => part.key), PARTS);
  for (const part of table.parts) assert.ok(part.label, part.key);
  for (const reader of table.readers) {
    assert.ok(reader.label, `${reader.key} has a name`);
    assert.deepEqual(reader.through, reader.live ? READERS[reader.key].parts : [], reader.key);
    for (const part of [...reader.through, ...reader.pages]) assert.ok(PARTS.includes(part), `${reader.key}: ${part}`);
  }
});

// Why (28 Oct 2026): a reader joins LIVE in the PR that wires its step; this list is the one place that says which are wired, so the page cannot get ahead of the app.
test('live readers: kit answers (CV + Experience bank, D1b); every other reader is built but not wired yet', () => {
  assert.deepEqual(LIVE, ['kit']);
  for (const key of LIVE) assert.ok(READERS[key], key);
  for (const key of Object.keys(PAGES)) assert.ok(key === 'form' || READERS[key], key);
});

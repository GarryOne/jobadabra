// The readers table the website shows (docs/about-you-readers.json) is the app's own READERS, exported: a reader is "live" there only when its bundle really reaches
// its step, and a cell never claims a part the reader does not take (owner via the coordinator, 28 Oct 2026: live only, nothing claimed before it works). No AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {FILE, text} from '../../tools/about-you-readers.mjs';
import os from 'node:os';
import path from 'node:path';
import {GATHERED, LIVE, PAGES, PARTS, READERS, aboutYou, readersTable} from '../lib/about-you.js';
import {createStorage} from '../lib/storage.js';

test('the exported JSON is the app\'s READERS: run node tools/about-you-readers.mjs when this fails', () => {
  assert.equal(fs.readFileSync(FILE, 'utf8'), text());
});

test('every reader and part has a name; a cell is claimed only for a live reader, and only for a part it takes', () => {
  const table = readersTable();
  assert.deepEqual(table.parts.map(part => part.key), PARTS);
  for (const part of table.parts) assert.ok(part.label, part.key);
  for (const reader of table.readers) {
    assert.ok(reader.label, `${reader.key} has a name`);
    assert.deepEqual(reader.through, reader.live ? READERS[reader.key].parts.filter(part => GATHERED.includes(part)) : [], reader.key);
    for (const part of [...reader.through, ...reader.pages]) assert.ok(PARTS.includes(part), `${reader.key}: ${part}`);
  }
});

// Why (28 Oct 2026, Gitar on #2361): a reader joins LIVE in the PR that wires its step; this list is the one place that says which are wired, so the page cannot get ahead of
// the app. Portrait is wired (lib/portrait.js reads aboutYou('portrait')), but gets only the parts aboutYou gathers: history and voice are still named as lacked.
test('live readers: kit answers (D1b) and Your portrait; every other reader is built but not wired yet', () => {
  assert.deepEqual(LIVE, ['kit', 'portrait']);
  for (const key of LIVE) assert.ok(READERS[key], key);
  for (const key of Object.keys(PAGES)) assert.ok(key === 'form' || READERS[key], key);
});

test('a part aboutYou() does not gather yet is always lacked, so the page never claims it', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-readers-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  const {lacked} = await aboutYou(storage, 'portrait');
  assert.deepEqual(READERS.portrait.parts.filter(part => !GATHERED.includes(part)).every(part => lacked.includes(part)), true);
  const portrait = readersTable().readers.find(reader => reader.key === 'portrait');
  assert.deepEqual(portrait.through, READERS.portrait.parts.filter(part => GATHERED.includes(part)));
});

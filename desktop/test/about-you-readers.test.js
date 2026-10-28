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
import * as store from '../lib/store/index.js';

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
// the app. Portrait is wired (lib/portrait.js reads aboutYou('portrait')), but gets only the parts aboutYou gathers: history is still named as lacked.
test('live readers: kit answers, Your portrait, CV tailoring and letters; every other reader is built but not wired yet', () => {
  assert.deepEqual(LIVE, ['kit', 'portrait', 'cv_tailor', 'letter']);
  for (const key of LIVE) assert.ok(READERS[key], key);
  for (const key of Object.keys(PAGES)) assert.ok(key === 'form' || READERS[key], key);
});

// Why (Gitar on #2361): seeded with every source aboutYou() reads, so the gathered parts must really come back and the rest must really be lacked; an empty store would pass whatever GATHERED says.
test('GATHERED is what a real aboutYou() call returns from a seeded store: those parts present, every other part lacked', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-readers-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  const opened = store.openStore(storage);
  await opened.page('answers').write('## Learned from forms\n| Question | Answer |\n|---|---|\n| Willing to travel | Yes, up to 20% |\n');
  await opened.page('profile').write('## Targets\n- **Roles:** Data engineer\n');
  fs.mkdirSync(storage.path('cv'), {recursive: true});
  fs.writeFileSync(path.join(storage.path('cv'), 'cv.json'), JSON.stringify({name: 'Alex Morgan', jobs: []}));
  const {parts, lacked} = await aboutYou(storage, 'portrait');
  const want = READERS.portrait.parts.filter(part => GATHERED.includes(part));
  assert.deepEqual(Object.keys(parts).sort(), [...want].sort());
  assert.deepEqual([...lacked].sort(), READERS.portrait.parts.filter(part => !want.includes(part)).sort());
});

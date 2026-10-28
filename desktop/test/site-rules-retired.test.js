// Local site rules are retired (owner, 28 Oct 2026: "Retire now, no replay"; plan docs/superpowers/plans/2026-10-28-what-we-learned.md, PR B1): no
// 🧠 Form knowledge note is written after a fill or at Submit, served to the extension, or read by a writer. What you typed at Submit is kept in
// What we learned (the answers page), where every later fill's AI reads it. Old notes stay in the store, unread; nothing is deleted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {save} from '../lib/learned.js';
import {me} from '../lib/server-contact.js';

const fresh = () => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-retired-')), {encrypt: v => v, decrypt: v => v}); s.saveSettings({store: 'sqlite', telemetry: false}); return s; };
const OLD_NOTE = '[job-boards.greenhouse.io · option] How did you hear: careers page → "Careers Website"';

test('what you typed at Submit is kept in What we learned, never as a Form knowledge note', async () => {
  const s = fresh(), said = [];
  const result = await save(s, {host: 'jobs.example.test', items: [{label: 'Driving license', value: 'B', kind: 'text'}, {label: 'Marital status', value: 'Single', kind: 'option'}]},
    {notify: (title, body) => said.push(`${title} · ${body}`)});
  assert.equal(result.ok, true);
  const answers = await store.openStore(s).page('answers').text();
  assert.match(answers, /^Driving license: B$/m);
  assert.match(answers, /^Marital status: Single$/m);
  assert.equal((await store.openStore(s).page('knowledge').text()).trim(), '', 'no note written');
  assert.match(said.join('\n'), /What we learned/);
  assert.doesNotMatch(said.join('\n'), /Form knowledge/);
});

// Gitar on #2326: the dedupe compared the raw line, so an answer kept with its kind mark ("[pick one: …]") was rewritten as plain text and lost its picker.
test('an answer already kept with its kind mark is not written again, and keeps its mark', async () => {
  const s = fresh(), said = [];
  await store.openStore(s).page('answers').append(['Marital status: Single [pick one: Single | Married]']);
  const result = await save(s, {items: [{label: 'Marital status', value: 'Single', kind: 'option'}]}, {notify: (...args) => said.push(args)});
  assert.equal(result.count, 0);
  assert.deepEqual(said, []);
  assert.match(await store.openStore(s).page('answers').text(), /^(- )?Marital status: Single \[pick one: Single \| Married\]$/m);
});

test('an old note left in the store is never served to the extension', async () => {
  const s = fresh();
  await store.openStore(s).page('knowledge').append([OLD_NOTE]);
  const reply = await me(s, 'https://job-boards.greenhouse.io/acme/jobs/1');
  assert.equal('knowledge' in reply, false);
  assert.equal(await store.openStore(s).page('knowledge').text().then(text => text.includes('Careers Website')), true, 'the old note is kept, unread');
});

test('no module writes or reads the site notes any more, and the extension uses none', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const gone of ['../lib/learn.js', '../lib/knowledge.js', '../renderer/knowledge-model.js']) assert.equal(fs.existsSync(path.join(here, gone)), false, gone);
  const flow = fs.readFileSync(path.join(here, '../../extension/flow.js'), 'utf8');
  assert.doesNotMatch(flow, /me\?\.knowledge|'form knowledge'/);
});

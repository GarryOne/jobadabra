// A replaced CV after setup: the previous one is kept to compare, Claude suggests Profile line edits, and only
// the accepted ones are written to Notion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cvChange from '../lib/cv-change.js';
import {createStorage} from '../lib/storage.js';
import {fakeNotion} from './fake-notion.js';

const plain = {encrypt: v => v, decrypt: v => v};
function setup({done = true} = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  const storage = createStorage(path.join(base, 'Jobadabra'), plain);
  fs.writeFileSync(storage.path('cv.pdf'), 'OLD');
  fs.writeFileSync(path.join(base, 'new.pdf'), 'NEW');
  storage.saveSettings({setupDone: done, cvName: 'CV_old.pdf', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}});
  storage.setSecret('NOTION_TOKEN', 'ntn');
  return {storage, file: path.join(base, 'new.pdf')};
}

test('replacing the CV after setup keeps the previous one to compare; during setup it just replaces it', () => {
  const a = setup();
  assert.deepEqual(cvChange.replace(a.storage, a.file, 'CV_final.pdf', new Date('2026-09-28T16:00:00Z')), {name: 'CV_final.pdf', review: true});
  assert.equal(fs.readFileSync(a.storage.path('cv.pdf'), 'utf8'), 'NEW');
  assert.equal(fs.readFileSync(a.storage.path(cvChange.PREVIOUS), 'utf8'), 'OLD');
  assert.deepEqual(a.storage.settings().cvChange, {previous: 'CV_old.pdf', at: '2026-09-28T16:00:00.000Z'});
  const b = setup({done: false});
  assert.equal(cvChange.replace(b.storage, b.file, 'CV.pdf').review, false);
  assert.ok(!fs.existsSync(b.storage.path(cvChange.PREVIOUS)) && !b.storage.settings().cvChange);
});

test('Claude sees both CVs and the numbered Profile; only accepted, valid suggestions are written', async () => {
  const a = setup();
  cvChange.replace(a.storage, a.file, 'CV_final.pdf');
  const page = fakeNotion(['## Skills', 'Kubernetes, Terraform', '## Experience', 'SRE at Acme (2022–2025)', 'Old certificate']);
  let asked;
  const client = {messages: {create: async request => {
    asked = request;
    return {stop_reason: 'end_turn', usage: {input_tokens: 10000, output_tokens: 500}, content: [{type: 'text', text: JSON.stringify({
      summary: 'New role and a CKA certificate.', suggestions: [
        {kind: 'update', line: 3, text: 'SRE at Acme (2022–2026)', why: 'CV: "2022 – 2026"'},
        {kind: 'add', line: 1, text: 'CKA (2026)', why: 'CV: "Certified Kubernetes Administrator"'},
        {kind: 'remove', line: 4, text: '', why: 'not in the new CV'},
        {kind: 'update', line: 99, text: 'nowhere', why: 'bad line'},
        {kind: 'add', line: 0, text: '  ', why: 'empty'}]})}]};
  }}};
  const result = await cvChange.review(a.storage, 'key', {client, fetcher: page.fetcher});
  assert.equal(asked.messages[0].content.filter(c => c.type === 'document').length, 2);
  assert.match(asked.messages[0].content[2].text, /\[3\] SRE at Acme/);
  assert.equal(result.suggestions.length, 3);
  assert.equal(result.usd, 0.03);
  const accepted = result.suggestions.filter(s => s.kind !== 'remove');  // the user leaves the removal unticked
  assert.deepEqual(await cvChange.apply(a.storage, accepted, page.fetcher), {applied: 2, failed: []});
  assert.deepEqual(page.texts(), ['## Skills', 'Kubernetes, Terraform', 'CKA (2026)', '## Experience', 'SRE at Acme (2022–2026)', 'Old certificate']);
  assert.equal(a.storage.settings().cvChange, null);
});

test('no previous CV on this computer: nothing to compare, said plainly', async () => {
  const a = setup();
  await assert.rejects(cvChange.review(a.storage, 'key', {client: {}}), /previous CV is not on this computer/);
});

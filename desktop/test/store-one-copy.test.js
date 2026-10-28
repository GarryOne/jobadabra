// One copy (spec D2): with the data on this Mac, nothing is written to Notion, even when a Notion token and page ids are still set
// (someone who chose this Mac, or connected Notion before choosing). Each Notion writer the app runs by itself is listed here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as files from '../lib/files.js';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as contact from '../lib/contact.js';

function onThisMacWithNotionLeft() {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-one-')), {encrypt: v => v, decrypt: v => v});
  storage.setSecret('NOTION_TOKEN', 'ntn');
  storage.saveSettings({store: 'sqlite', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers', NOTION_AGENT_RUNS_DB: 'runs'}});
  fs.writeFileSync(storage.path('cv.pdf'), '%PDF-1.4');
  return storage;
}
const noNotion = async url => { throw new Error(`Notion was called: ${url}`); };

test('the CV and the cover letter are not uploaded to Notion when the store is this Mac', async () => {
  const storage = onThisMacWithNotionLeft();
  assert.deepEqual(await files.syncCv(storage, noNotion), {skipped: 'the data is on this Mac'});
  assert.equal(await files.coverLetterToProfile(storage, storage.path('cv.pdf'), noNotion), null);
});

test('contact details go to this Mac\'s profile.md, not the Notion Profile', async () => {
  const storage = onThisMacWithNotionLeft();
  assert.equal(store.openStore(storage).name, 'sqlite');
  await contact.save(storage, {email: 'a@b.c', phone: '1'}, noNotion);
  assert.match(storage.readText('profile.md'), /## 📇 Contact details\n- Email: a@b\.c\n- Phone: 1/);
  assert.deepEqual(await contact.read(storage, noNotion), {email: 'a@b.c', phone: '1'});
});

test('session stats and conversations go to this Mac\'s store, never to the Notion still connected', async () => {
  const {optionsFor} = await import('../lib/session-runs.js');
  const options = optionsFor(onThisMacWithNotionLeft(), {call: async () => null});
  assert.equal(options.db, undefined);
  assert.equal(options.call, undefined);
  assert.equal(typeof options.agentRuns, 'function');
  const main = fs.readFileSync(path.join(import.meta.dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /sessionRuns\.optionsFor\(storage,/);          // main.js asks the store, never builds a Notion call itself
  assert.match(main, /sessionRuns\.saveConversation\(storage, session, talk\)/);
});

test('the extension reads the Profile and answers from this Mac, never the retired form knowledge, and gets no Notion token', async () => {
  const {localEnv} = await import('../lib/server-env.js');
  const storage = onThisMacWithNotionLeft();
  storage.writeText('profile.md', '## Summary\n- SRE, 8 years\n');
  storage.writeText('answers.md', '- Notice period: 3 months\n');
  storage.writeText('knowledge.md', '- [acme.com · answer] Pronouns: Same as before → "they/them"\n');
  const env = localEnv(storage, undefined, {find: async () => null});
  assert.equal(env.NOTION_TOKEN, '');
  assert.equal(env.NOTION_PROFILE_PAGE_ID, '');
  assert.match(await env.PROFILE_TEXT, /SRE, 8 years/);
  assert.match(await env.ANSWERS_TEXT, /Notice period: 3 months/);
  assert.equal(env.KNOWLEDGE_TEXT, undefined, 'retired in PR B1: the old notes stay in knowledge.md, unread');
});

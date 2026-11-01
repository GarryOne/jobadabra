// The pieces both storemove tests share (storemove-integration, storemove-empty-notion): what a finished move holds, the stubs around it and a seeded install on a stand-in Notion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildStandIn} from '../../e2e/lib/notion-fake.mjs';
import {fileBlocks, rowsIn, seedStore} from '../../e2e/lib/storemove-steps.mjs';

export const WANTED = {applications: 3, events: 2, interviews: 1, files: 1};
/** -> how many rows (applications, events, interviews) and file blocks a stand-in Notion holds, read from the stand-in's own dump; compare with WANTED. */
export const countsIn = fake => ({applications: rowsIn(fake, 'Job Tracker'), events: rowsIn(fake, 'Events'), interviews: rowsIn(fake, 'Interviews'), files: fileBlocks(fake)});
export const publish = async () => {};   // ⚙️ Search settings page: not part of the data move (test/store-move.test.js)
export const repair = async (_token, ids) => ({ids});   // the stand-in's workspace is built whole by buildStandIn

/** The Knowledge page is made before the copy writes it (lib/store-move.js): the app's own `ensureKnowledgePage`, every request to this install's stand-in. */
export const knowledgeOnWith = ensureKnowledgePage => fake => storage => ensureKnowledgePage(storage, {fetcher: (url, options) => fetch(String(url).replace(/^(https:\/\/api\.notion\.com|http:\/\/127\.0\.0\.1:\d+)/, fake.url), options)});

/** An install on this Mac's SQLite store (3 jobs, 2 events, 1 interview, 1 file) whose Notion is the stand-in's fresh workspace; `createStorage` is the app's, imported after the isolation switches. */
export const installerWith = createStorage => async fake => {
  process.env.JOB_PILOTTO_E2E_NOTION_BASE_URL = fake.url;   // the engine's copy takes its Notion from the environment the app gives it (lib/pipeline-env.js)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-storemove-int-'));
  const storage = createStorage(profile, {encrypt: value => value, decrypt: value => value});
  fs.mkdirSync(path.join(profile, 'data'), {recursive: true});
  storage.saveSettings({store: 'sqlite', setupDone: true});
  const seeded = seedStore(profile);
  assert.equal(seeded.applications, 3, `the seed wrote ${JSON.stringify(seeded)}`);
  const ids = await buildStandIn(fake);
  storage.saveSettings({notionIds: ids});
  storage.setSecret('NOTION_TOKEN', fake.token);
  return {profile, storage, ids};
};

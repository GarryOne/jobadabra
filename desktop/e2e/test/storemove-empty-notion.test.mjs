// Layer 3 (Node + the engine's real SQLite store + the Notion stand-in, no window): "Move my data to Notion" into an empty Notion (desktop/lib/store-move.js, src/stores/copy.py).
// The same check as the storemove e2e step "the imported install moves into an empty Notion: its Profile and every record arrive once" (a data step: it stays in e2e too).
// The move is the real one (moveToNotion → `python -m src.stores.copy` through lib/pipeline-run.js) on a seeded SQLite store in a temp folder; only Notion is the stand-in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {buildStandIn, startNotionFake} from '../lib/notion-fake.mjs';
import {fileBlocks, pageText, rowsIn, seedStore, settingsOf} from '../lib/storemove-steps.mjs';

// The app's own isolation switches, set before the app's modules read them (lib/notion-core.js reads the base URL when it loads).
const standIn = await startNotionFake();
Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_NOTION_BASE_URL: standIn.url, JOB_PILOTTO_E2E_NOTION_STANDIN: '1', JOB_PILOTTO_FOLLOW_APP: '0'});
const {createStorage} = await import('../../lib/storage.js');
const {moveToNotion} = await import('../../lib/store-move.js');
const {ensureKnowledgePage} = await import('../../lib/store/notion.js');

const WANTED = {applications: 3, events: 2, interviews: 1, files: 1};
const countsIn = fake => ({applications: rowsIn(fake, 'Job Tracker'), events: rowsIn(fake, 'Events'), interviews: rowsIn(fake, 'Interviews'), files: fileBlocks(fake)});
const publish = async () => {};   // ⚙️ Search settings page: not part of the data move (test/store-move.test.js)
const repair = async (_token, ids) => ({ids});   // the stand-in's workspace is built whole by buildStandIn

// The Knowledge page is made before the copy writes it (lib/store-move.js): the app's own code, every request to this install's stand-in.
const knowledgeOn = fake => storage => ensureKnowledgePage(storage, {fetcher: (url, options) => fetch(String(url).replace(/^(https:\/\/api\.notion\.com|http:\/\/127\.0\.0\.1:\d+)/, fake.url), options)});

async function install(fake) {
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
}

test('an install moving into an empty Notion: its Profile and every record arrive once', async () => {
  const empty = standIn;   // a Notion with nothing of its own, as the imported install's
  {
    const {profile, storage, ids} = await install(empty);
    storage.saveSettings({storeTextsWin: true});   // the connect built this workspace just now: this Mac's texts win over the template's
    const done = await moveToNotion(storage, {repair, publish, knowledgePage: knowledgeOn(empty)});
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.ok(!/already had/.test(JSON.stringify(done.kept)) && done.kept.length === 0, `the move says it kept ${JSON.stringify(done.kept)}`);
    assert.deepEqual(countsIn(empty), WANTED);
    assert.ok(pageText(empty, ids.NOTION_PROFILE_PAGE_ID).includes('ten years'), 'this Mac\'s Profile did not reach the empty Notion');
    assert.equal(settingsOf(profile).store, 'notion');
    assert.deepEqual(empty.stats.unknown, [], 'the stand-in met requests it does not know');
    // A second press changes nothing: the data is on Notion now.
    assert.equal((await moveToNotion(storage, {repair, publish})).ok, false);
    assert.deepEqual(countsIn(empty), WANTED);
  }
});

test('teardown', async () => { await standIn.close(); });

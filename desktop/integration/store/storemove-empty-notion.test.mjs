// Layer 3 (Node + the engine's real SQLite store + the Notion stand-in, no window): "Move my data to Notion" into an empty Notion (desktop/lib/store-move.js, src/stores/copy.py).
// The same check as the storemove e2e step "the imported install moves into an empty Notion: its Profile and every record arrive once" (a data step: it stays in e2e too).
// TODO(AI): drop one of the two copies (this Node test or the storemove e2e step) once the owner decides which stays; until then both run and must not drift (#2763)
// The move is the real one (moveToNotion → `python -m src.stores.copy` through lib/pipeline-run.js) on a seeded SQLite store in a temp folder; only Notion is the stand-in.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startNotionFake} from '../../e2e/lib/notion-fake.mjs';
import {pageText, settingsOf} from '../../e2e/lib/storemove-steps.mjs';

// The app's own isolation switches, set before the app's modules read them (lib/notion-core.js reads the base URL when it loads).
const standIn = await startNotionFake();
Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_NOTION_BASE_URL: standIn.url, JOB_PILOTTO_E2E_NOTION_STANDIN: '1', JOB_PILOTTO_FOLLOW_APP: '0'});
const {createStorage} = await import('../../lib/storage.js');
const {moveToNotion} = await import('../../lib/store-move.js');
const {ensureKnowledgePage} = await import('../../lib/store/notion.js');

const {WANTED, countsIn, publish, repair, knowledgeOnWith, installerWith} = await import('./storemove-support.mjs');
const knowledgeOn = knowledgeOnWith(ensureKnowledgePage);
const install = installerWith(createStorage);

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

// Layer 3 (Node + the engine's real SQLite store + the Notion stand-in, no window): "Move my data to Notion" (desktop/lib/store-move.js, src/stores/copy.py).
// The same check as the storemove e2e step (a data-integrity step, so it stays in e2e too until the owner decides; coordinator, 1 Nov 2026):
//   - "a move killed halfway changes nothing, and the next one goes on with nothing twice"
// The empty-Notion move is test/storemove-empty-notion.test.mjs (one stand-in per file: lib/notion-core.js reads the base URL when it loads).
// The move is the real one (moveToNotion → `python -m src.stores.copy` through lib/pipeline-run.js) on a seeded SQLite store in a temp folder; only Notion is the stand-in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {buildStandIn, startNotionFake} from '../lib/notion-fake.mjs';
import {NOTION_PROFILE, fileBlocks, journalOf, pageText, rowsIn, seedStore, settingsOf, writeProfile} from '../lib/storemove-steps.mjs';

// The app's own isolation switches, set before the app's modules read them (lib/notion-core.js reads the base URL when it loads).
const standIn = await startNotionFake();
Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_NOTION_BASE_URL: standIn.url, JOB_PILOTTO_E2E_NOTION_STANDIN: '1', JOB_PILOTTO_FOLLOW_APP: '0'});
const {createStorage} = await import('../../lib/storage.js');
const {moveToNotion, STOPPED} = await import('../../lib/store-move.js');
const pipelineRun = await import('../../lib/pipeline-run.js');
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

test('a move killed halfway changes nothing, and the next one goes on with nothing twice', async () => {
  const {profile, storage, ids} = await install(standIn);
  writeProfile(standIn, ids.NOTION_PROFILE_PAGE_ID, NOTION_PROFILE);   // a Profile Notion already had
  // The copy is killed as a crash or a power cut would, right after its first application: the progress line is the event, no clock.
  let child = null, killed = false;
  const killAfterFirst = (s, args, onLine, extra, options) => pipelineRun.run(s, args, line => {
    onLine(line);
    if (/^moving applications 1\/3$/.test(String(line).trim()) && !killed) { killed = true; child.kill('SIGKILL'); }
  }, extra, {...options, onChild: spawned => { child = spawned; }});
  const stopped = await moveToNotion(storage, {run: killAfterFirst, repair, publish, knowledgePage: knowledgeOn(standIn)});
  assert.ok(killed, 'positive control: the copy was killed after its first application');
  assert.deepEqual(stopped, {ok: false, error: STOPPED});
  assert.equal(settingsOf(profile).store, 'sqlite', 'a killed move switched the store');
  assert.ok(fs.existsSync(path.join(profile, 'data', 'tracker.sqlite')), 'a killed move took the SQLite store away');
  for (const name of ['profile.md', 'answers.md', 'knowledge.md']) assert.ok(fs.existsSync(path.join(profile, name)), `a killed move took ${name} off this Mac`);
  const movedBefore = Object.keys(journalOf(profile).applications || {}).length;
  assert.ok(movedBefore >= 1 && movedBefore < 3, `the journal holds ${movedBefore} of 3 applications: the kill came too late or too early`);

  const done = await moveToNotion(storage, {repair, publish, knowledgePage: knowledgeOn(standIn)});
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.deepEqual(countsIn(standIn), WANTED, 'after a killed move and a second one, every record is in Notion once');
  assert.equal(settingsOf(profile).store, 'notion');
  assert.ok(!fs.existsSync(path.join(profile, 'data', 'tracker.sqlite')), 'still in use on this Mac after the move: data/tracker.sqlite');
  assert.ok(fs.existsSync(path.join(done.archive, 'data', 'tracker.sqlite')), 'the archive lacks the SQLite store');
  assert.ok(fs.readdirSync(path.join(done.archive, 'data', 'files')).length, 'the archive lacks the job files');
  assert.ok(done.kept.includes('profile'), `the Profile Notion already had is named as kept: ${JSON.stringify(done.kept)}`);
  const profileText = pageText(standIn, ids.NOTION_PROFILE_PAGE_ID);
  assert.ok(profileText.includes(NOTION_PROFILE) && !profileText.includes('ten years'), `the Notion Profile was not kept: "${profileText.slice(0, 200)}"`);
  assert.ok(fs.readFileSync(path.join(done.archive, 'profile.md'), 'utf8').includes('ten years'), 'this Mac\'s Profile is not in the archive');
  assert.deepEqual(standIn.stats.unknown, [], 'the stand-in met requests it does not know');
});

test('teardown', async () => { await standIn.close(); });

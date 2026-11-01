// Layer 3 (Node + the engine's real SQLite store + the Notion stand-in, no window): "Start using Notion" (spec D3), moved from the wizard e2e step "a Notion token connects: the workspace is
// built inside the test page and the strategy moves in" (1 Nov 2026, wizard 2/2). A new install keeps its data on this Mac; when Notion is connected while that store is still empty, the store
// becomes Notion and the strategy written during setup moves into the Profile page. The window glue (the reload that makes the window know) stays covered by every e2e suite that builds its
// workspace through the wizard's connect (lib/wizard.mjs connectNotion, on the Notion stand-in leg).
// The connect is the main process's closure (main.js connectNotion), which needs Electron: this test makes the same calls in the same order (test/connect-notion-order.test.js pins that order in the source).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {buildStandIn, startNotionFake} from '../../e2e/lib/notion-fake.mjs';
import {pageText, seedStore} from '../../e2e/lib/storemove-steps.mjs';

const standIn = await startNotionFake();
Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_NOTION_BASE_URL: standIn.url, JOB_PILOTTO_E2E_NOTION_STANDIN: '1', JOB_PILOTTO_FOLLOW_APP: '0'});
const {createStorage} = await import('../../lib/storage.js');
const {startOnNotionIfEmpty} = await import('../../lib/store-handlers.js');
const migrate = await import('../../lib/migrate.js');

const STRATEGY = `# Profile\n\nWizard strategy: ${'a platform engineer in Zurich, ten years of infrastructure work. '.repeat(5)}`;

/** A new install after setup: this Mac's store (empty unless `withData`), the strategy the wizard wrote, and a Notion workspace the app has just built in the stand-in. */
async function installAfterSetup({withData = false, profileText = STRATEGY} = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-wizard-notion-start-'));
  const storage = createStorage(profile, {encrypt: value => value, decrypt: value => value});
  fs.mkdirSync(path.join(profile, 'data'), {recursive: true});
  storage.saveSettings({store: 'sqlite', setupDone: true});
  if (withData) assert.equal(seedStore(profile).applications, 3);   // writes profile.md / answers.md too, with its own texts
  storage.writeText('profile.md', profileText);
  const ids = await buildStandIn(standIn);   // connectWorkspace, the app's own code (lib/notion-core.js reads the stand-in's address when it loads, so one stand-in serves both tests)
  return {profile, storage, ids};
}

/** main.js connectNotion after the workspace is found or built (`built`: the connect made pages, main.js's `result.built?.length`; false = it found a workspace that was there): secrets and ids saved, the empty-store check, the connect settings, then the move-in. -> {startedOnNotion, moved}. */
async function connectAfterWorkspace({storage, ids}, {built = true} = {}) {
  storage.setSecret('NOTION_TOKEN', standIn.token);
  storage.saveSettings({notionIds: ids});
  const hadLocal = !!(storage.readText('profile.md').trim() || storage.readText('answers.md').trim());
  const startedOnNotion = await startOnNotionIfEmpty(storage);
  storage.saveSettings(migrate.connectSettings(storage.settings(), {hadLocal, fresh: built}));
  // Only the strategy's move-in: the other steps (employers, search settings, ...) need data this test does not seed and are covered where they live (strategy-notion-integration.test.mjs, storemove).
  const moved = await migrate.run(storage, line => { if (/failed/i.test(line)) throw new Error(`the move-in reported: ${line}`); }, migrate.STEPS.filter(step => step.name === 'strategy from this Mac'));
  return {startedOnNotion, moved};
}

test('Notion connected on an empty Mac store: the store becomes Notion and the strategy moves into the Profile page', async () => {
  const install = await installAfterSetup();
  assert.equal(install.storage.settings().store, 'sqlite', 'positive control: the install starts on this Mac');
  assert.ok(fs.existsSync(path.join(install.profile, 'profile.md')), 'positive control: the strategy is on this Mac before the connect');
  const {startedOnNotion, moved} = await connectAfterWorkspace(install);
  assert.equal(startedOnNotion, true, 'an empty store did not become Notion at connect');
  assert.equal(JSON.parse(fs.readFileSync(path.join(install.profile, 'settings.json'), 'utf8')).store, 'notion');
  assert.deepEqual(moved, ['strategy from this Mac']);
  const profileText = pageText(standIn, install.ids.NOTION_PROFILE_PAGE_ID);
  assert.ok(profileText.includes('Wizard strategy') && profileText.length >= 200, `the strategy did not reach the Notion Profile page (it holds ${profileText.length} characters)`);
  assert.ok(!fs.existsSync(path.join(install.profile, 'profile.md')), 'profile.md is still on this Mac after it moved to Notion');
  assert.deepEqual(standIn.stats.unknown, [], 'the stand-in met requests it does not know');
});

test('with data already on this Mac the connect leaves the store where it is: the way to Notion is the move', async () => {
  const install = await installAfterSetup({withData: true});
  const {startedOnNotion, moved} = await connectAfterWorkspace(install);
  assert.deepEqual(moved, [], 'nothing moves into a Notion the data does not live in');
  assert.equal(startedOnNotion, false, 'a store with data became Notion without the move');
  assert.equal(JSON.parse(fs.readFileSync(path.join(install.profile, 'settings.json'), 'utf8')).store, 'sqlite');
});

/** What the person (or a first run) leaves behind: a Profile page with no blocks. */
function blankPage(pageId) {
  const {body} = standIn.handle('GET', `blocks/${pageId}/children`, {}, new URLSearchParams());
  for (const block of body.results || []) standIn.handle('DELETE', `blocks/${block.id}`, {}, new URLSearchParams());
}

const DRAFT = `# Profile\n\nTarget: CHF 170,000 per year in Switzerland\nMinimum acceptable: CHF 140,000 per year in Switzerland\n\nWizard strategy: ${'a site reliability engineer in Zurich. '.repeat(8)}`;

test('Notion found with its Profile page still the blank template: the draft kept on this Mac reaches the page before the local copy goes (#2759)', async () => {
  const install = await installAfterSetup({profileText: DRAFT});
  blankPage(install.ids.NOTION_PROFILE_PAGE_ID);   // the stand-in is shared by the tests: the workspace the connect finds has a Profile with nothing on it
  assert.equal(pageText(standIn, install.ids.NOTION_PROFILE_PAGE_ID), '', 'positive control: the Notion Profile is blank before the connect');
  const {moved} = await connectAfterWorkspace(install, {built: false});   // a workspace that was already there: nothing was built
  const profileText = pageText(standIn, install.ids.NOTION_PROFILE_PAGE_ID);
  const lines = name => profileText.split('\n').filter(line => line.trim().startsWith(name)).length;
  assert.ok(lines('Target:') === 1 && lines('Minimum acceptable:') === 1,
    `the Notion Profile should hold the draft's one Target line and one Minimum acceptable line, found ${lines('Target:')} and ${lines('Minimum acceptable:')}; the draft had ${DRAFT.length} characters; moved: ${moved.join(', ') || 'nothing'}; the page holds ${profileText.length} characters: ${JSON.stringify(profileText.slice(0, 160))}; profile.md ${fs.existsSync(path.join(install.profile, 'profile.md')) ? 'still on this Mac' : 'gone from this Mac'}`);
});

test('teardown', async () => { await standIn.close(); });

// Layer 3 (Node + the real engine + the Notion stand-in, no window): the former strategy e2e suite's Notion leg (suites/strategy.mjs, removed with this test in #2763). The ⚙️ Search settings page
// is a Notion rendering of the settings: a change made in the app reaches the page and config/search.json, an edit made on the page is used by the next check, and an app
// connected again to the same page links it and keeps its settings. The app's own writers (lib/strategy-settings.js, lib/migrate.js) and the engine's page sync run for real
// against the stand-in; the check is the steps of a Find jobs press over the suite's fixture boards, no AI set up (keeping or dropping a posting is decided before scoring, so the digest lists the kept ones unscored). Replaces these e2e steps (Notion leg):
//   - "a role and a place added in the app reach the Notion page and config/search.json"
//   - "a company to skip, set in the app, reaches Notion and config/preferences.json"
//   - "an edit made directly on the Notion page is used by the next check, and a removed role stops matching"
//   - "a region word and a level written on the Notion page decide which postings the next check keeps"
//   - "a fresh install reconnecting to the same Notion page keeps the real settings and links the same page"
// The Mac-store steps are strategy-integration.test.mjs; they share the check, the boards and the start state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {applicantDraft} from '../../e2e/lib/applicant-seed.mjs';
import {buildStandIn, startNotionFake} from '../../e2e/lib/notion-fake.mjs';
import {ensureSection, findPagesBeside, pageSections, restoreSections, setSection, useNotionAt} from '../../e2e/lib/notion.mjs';
import {GIRAFFE, PLACE, ROLE, SKIP, addPosting as addPostingTo, checker, has, listed} from './strategy-support.mjs';

const E2E = path.resolve(import.meta.dirname, '..', '..', 'e2e');
const FEEDS = path.join(E2E, 'fixtures', 'feeds');
const TITLE = '⚙️ Search settings';

const fake = await startNotionFake();
useNotionAt(fake.url);
const feeds = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-strategy-feeds-'));
fs.cpSync(FEEDS, feeds, {recursive: true});
Object.assign(process.env, {JOBADABRA_E2E: '1', JOBADABRA_FIXTURE_DIR: feeds, JOBADABRA_FOLLOW_APP: '0',
  JOBADABRA_E2E_NOTION_BASE_URL: fake.url, JOBADABRA_E2E_NOTION_STANDIN: '1'});
const {createStorage} = await import('../../lib/storage.js');
const {ensureConfig} = await import('../../lib/pipeline-env.js');
const pipelineRun = await import('../../lib/pipeline-run.js');
const {searchSteps} = await import('../../lib/search-steps.js');
const strategy = await import('../../lib/strategy-settings.js');
const migrate = await import('../../lib/migrate.js');
const notion = await import('../../lib/notion.js');
const {START} = await import('../../e2e/test/strategy-start.mjs');

const ids = await buildStandIn(fake);
const install = () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-strategy-notion-'));
  const storage = createStorage(profile, {encrypt: value => value, decrypt: value => value});
  storage.saveSettings({store: 'notion', setupDone: true, lastScoutAt: new Date(0).toISOString(), notionIds: {...ids}});
  storage.setSecret('NOTION_TOKEN', fake.token);
  ensureConfig(storage);
  return {profile, storage};
};
const {profile, storage} = install();
const read = (file, folder = profile) => JSON.parse(fs.readFileSync(path.join(folder, 'config', file), 'utf8'));
const exec = (s, args, onLine, extra, options) => pipelineRun.run(s, args, onLine, {...extra, JOBADABRA_STORE: 'notion', JOBADABRA_FOLLOW_APP: '0'}, options);
const deps = {run: exec, ensurePage: notion.ensurePage, writePage: notion.writePage};
const settingsPage = () => storage.settings().notionIds.NOTION_SEARCH_SETTINGS_PAGE;
const sections = () => pageSections(fake.token, settingsPage());
// The window's saveStrategy on a Notion store (lib/strategy-draft-handlers.js): the page is read first, the accepted parts are saved, the page is written again.
const saveInApp = async (search, preferences) => {
  await exec(storage, ['src.notion.search_settings', 'sync']);
  strategy.save(storage, {search, preferences});
  await strategy.publishSearchSettings(storage, deps);
};
const addPosting = (...args) => addPostingTo(feeds, ...args);
const check = checker(searchSteps, storage, exec);

test('the app links its Search settings page, which starts from this suite\'s start state, and the check keeps neither new posting', async () => {
  const draft = applicantDraft();
  strategy.save(storage, {search: draft.search, preferences: draft.preferences});
  fs.copyFileSync(path.join(FEEDS, 'sources-strategy.json'), path.join(profile, 'config', 'sources.json'));
  assert.deepEqual(await migrate.run(storage, () => {}, migrate.STEPS.filter(step => step.name === 'search settings')), ['search settings']);
  assert.ok(settingsPage(), 'the app has no ⚙️ Search settings page id after the migration');
  assert.equal((await findPagesBeside(fake.token, ids.NOTION_PROFILE_PAGE_ID, TITLE)).length, 1, 'expected exactly the linked page');
  await restoreSections(fake.token, settingsPage(), START);   // the declared start state, whatever the page held
  const jobs = await check();   // the engine takes the page first (src/notion/search_settings.py)
  assert.ok(!listed(jobs, 'zebra|giraffe'), `jobs for roles nobody asked for were kept: ${jobs.filter(job => /zebra|giraffe/i.test(job)).join('; ')}`);
  assert.ok(has((await sections())['Target roles'], 'data analyst'), 'the page does not hold the start roles');
});

test('a role and a place added in the app reach the Notion page and config/search.json; a company to skip reaches Notion and config/preferences.json', async () => {
  const added = await strategy.addRoles(storage, [ROLE], deps);
  assert.ok(added.added.includes(ROLE), `addRoles: ${JSON.stringify(added)}`);
  const search = read('search.json');
  await saveInApp({locations: {...search.locations, top_tier: [...search.locations.top_tier, PLACE]}}, null);
  const file = read('search.json'), page = await sections();
  assert.ok(has(file.role_keywords, ROLE) && has(file.locations.top_tier, PLACE), `config/search.json lacks the new role or place (roles: ${file.role_keywords.join(', ')}; places: ${file.locations.top_tier.join(', ')})`);
  assert.ok(has(page['Target roles'], ROLE), `the Notion page lacks the role (it lists: ${(page['Target roles'] || []).join(', ')})`);
  assert.ok(has(page['Best places'], PLACE), `the Notion page lacks the place (it lists: ${(page['Best places'] || []).join(', ')})`);
  const jobs = await check();
  assert.ok(listed(jobs, 'zebra', 'Senior'), `the Zebra Wrangler posting was not kept (listed: ${jobs.join('; ') || 'nothing'})`);
  assert.ok(!listed(jobs, 'giraffe'), 'the Giraffe Keeper posting was kept without anybody asking for that role');

  const preferences = read('preferences.json');
  await saveInApp(null, {...preferences, excluded_companies: [...(preferences.excluded_companies || []), SKIP]});
  assert.ok(has(read('preferences.json').excluded_companies, SKIP), 'config/preferences.json lacks the company');
  const after = await sections();
  assert.ok(has(after['Companies to skip'], SKIP), `the Notion page lacks the company (it lists: ${(after['Companies to skip'] || []).join(', ')})`);
  assert.ok(has(after['Target roles'], ROLE), 'saving the companies lost the role added before');
  // the skipped company is not kept any more, while the same role at the other board still is
  addPosting('initech.json', 3102, 'Staff Zebra Wrangler, Platform');
  addPosting('zebra.json', 3005, 'Senior Zebra Wrangler, Data');
  const later = await check();
  assert.ok(!listed(later, 'Platform', 'Staff'), 'a new posting from the skipped company was kept');
  assert.ok(listed(later, 'Data', 'Senior'), 'a new posting from a company that is not skipped was lost');
});

test('an edit made directly on the Notion page is used by the next check, and a removed role stops matching', async () => {
  const before = await sections();
  // The page is the source of truth: a person adds a role there, and takes the other one out.
  await setSection(fake.token, settingsPage(), 'Target roles', [...before['Target roles'].filter(entry => !has([entry], ROLE)), GIRAFFE]);
  addPosting('zebra.json', 3006, 'Senior Zebra Wrangler, Cloud');
  addPosting('zebra.json', 3007, 'Senior Giraffe Keeper, Cloud');
  const jobs = await check();
  const file = read('search.json');
  assert.ok(has(file.role_keywords, GIRAFFE) && !has(file.role_keywords, ROLE), `config/search.json did not follow the page: ${file.role_keywords.join(', ')}`);
  assert.ok(listed(jobs, 'giraffe keeper, cloud'), `the role added in Notion found nothing (listed: ${jobs.join('; ') || 'nothing'})`);
  assert.ok(!listed(jobs, 'zebra wrangler, cloud'), 'the role removed in Notion still matches a new posting');
});

test('a region word and a level written on the Notion page decide which postings the next check keeps', async () => {
  // "Ticino" is a region word (src/regions.py): a posting in Bellinzona has no "lugano" in it. "junior" skips the titles that plainly name a senior role.
  await setSection(fake.token, settingsPage(), 'Best places', ['Ticino']);
  await ensureSection(fake.token, settingsPage(), 'Your level', ['junior']);
  addPosting('zebra.json', 3008, 'Junior Giraffe Keeper, Nord', 'Bellinzona');
  addPosting('zebra.json', 3009, 'Senior Giraffe Keeper, Nord', 'Bellinzona');
  addPosting('zebra.json', 3010, 'Junior Giraffe Keeper, Sued', 'Zurich, Switzerland');
  const jobs = await check();
  const file = read('search.json');
  assert.ok(has(file.locations?.top_tier, 'ticino') && has(file.level, 'junior'), `config/search.json did not follow the page: places ${(file.locations?.top_tier || []).join(', ')}; level ${(file.level || []).join(', ') || 'none'}`);
  assert.ok(listed(jobs, 'junior giraffe keeper, nord'), `a posting in Bellinzona was not kept for the region "Ticino" (listed: ${jobs.join('; ') || 'nothing'})`);
  assert.ok(!listed(jobs, 'senior giraffe keeper, nord'), 'the level "junior" still kept a Senior title');
  assert.ok(!listed(jobs, 'giraffe keeper, sued'), 'a posting in Zurich was kept for the region "Ticino"');
});

test('a fresh install reconnecting to the same Notion page keeps the real settings and links the same page', async () => {
  const id = settingsPage(), wanted = await sections();
  const again = install();   // a new profile on the same workspace: no page linked yet
  again.storage.saveSettings({notionIds: {...ids}});
  assert.ok(!again.storage.settings().notionIds.NOTION_SEARCH_SETTINGS_PAGE);
  const moved = await migrate.run(again.storage, () => {}, migrate.STEPS.filter(step => step.name === 'search settings'));
  assert.deepEqual(moved, ['search settings']);
  const linked = again.storage.settings().notionIds.NOTION_SEARCH_SETTINGS_PAGE;
  assert.equal(String(linked).replace(/-/g, ''), String(id).replace(/-/g, ''), `the reconnected app linked a different page (${linked} instead of ${id})`);
  assert.equal((await findPagesBeside(fake.token, ids.NOTION_PROFILE_PAGE_ID, TITLE)).length, 1, 'a second Search settings page exists after reconnecting');
  assert.deepEqual(await pageSections(fake.token, id), wanted, 'reconnecting changed the settings on the Notion page');
  // The new profile has no settings yet: its first crawl takes the page, so the real settings are what the engine uses.
  await exec(again.storage, ['src.notion.search_settings', 'sync']);
  assert.ok(has(read('search.json', again.profile).role_keywords, GIRAFFE), 'the reconnected install did not take the page\'s roles');
});

test('the Notion stand-in knew every request', async () => {
  assert.deepEqual(fake.stats.unknown, []);
});

test('teardown', async () => { await fake.close(); });

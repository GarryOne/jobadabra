// Layer 3 (Node + the engine's real SQLite store + the Notion stand-in, no window): what Jobs, Focus, Interviews and Recent activity are handed stays the same across a move and an import. Moved from the
// e2e suite storemove (1 Nov 2026, owner: "storemove it not a critical user journey … This again should be an integrations"): the steps "an app on this Mac's store holds real-shaped data on every
// screen", "Export data writes this Mac's data to one file", "Jobs, Focus, Interviews and Recent activity show the same items from Notion" and "the export, imported into a fresh install, shows the
// same on every screen (still this Mac's store)".
// What each screen is handed is read from the engine the way the app reads it (`python -m src.desktop jobs` for Jobs, `src.focus` for Focus, the store's interviews and cron_runs for Interviews and
// Recent activity), on the store the app is on: this Mac's SQLite before, Notion (the stand-in) after the move, a fresh folder after the import. The move and the import are the app's own code
// (lib/store-move.js, lib/reset.js). What the window draws from these payloads is tested where the screens are (integration/app/screen-*.test.js).
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {startNotionFake} from '../../e2e/lib/notion-fake.mjs';
import {python} from '../../e2e/lib/python.mjs';
import {storeCall, storeEnv} from '../../e2e/lib/store-call.mjs';
import {COMPANIES, settingsOf} from '../../e2e/lib/storemove-steps.mjs';

// The app's own isolation switches, set before the app's modules read them (lib/notion-core.js reads the base URL when it loads).
const standIn = await startNotionFake();
Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_NOTION_BASE_URL: standIn.url, JOB_PILOTTO_E2E_NOTION_STANDIN: '1', JOB_PILOTTO_FOLLOW_APP: '0'});
const {createStorage} = await import('../../lib/storage.js');
const {moveToNotion} = await import('../../lib/store-move.js');
const {ensureConfig} = await import('../../lib/pipeline-env.js');
const reset = await import('../../lib/reset.js');
const {ensureKnowledgePage} = await import('../../lib/store/notion.js');
const {knowledgeOnWith, installerWith, publish, repair} = await import('./storemove-support.mjs');
/** The install of storemove-support, with the first-run config the engine reads (the app writes it at its first start: lib/pipeline-env.js ensureConfig). */
const install = async fake => { const made = await installerWith(createStorage)(fake); ensureConfig(made.storage); return made; };

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const SHELL = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SYSTEMROOT'];

/** The engine's own answer for `args` on the store `profile` is on (its settings.json): this Mac's, or the stand-in Notion with the token the app holds. -> the last stdout line, parsed. */
async function engine(profile, token, ...args) {
  const env = {...Object.fromEntries(SHELL.filter(name => process.env[name]).map(name => [name, process.env[name]])), PYTHONUTF8: '1',
    ...storeEnv({profile, token, notionUrl: standIn.url, standIn: true})};
  // Async, never execFileSync: the Notion stand-in runs in this process and must keep answering the engine's requests.
  const {stdout: out} = await promisify(execFile)(python(), ['-m', ...args], {cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000});
  return JSON.parse(out.trim().split('\n').pop());
}
const named = text => COMPANIES.filter(name => text.includes(name));

/** {jobs, focus, interviews, activity}: which seeded items each screen is handed (the e2e suite's `screens`, from the engine instead of the DOM). */
async function screens(profile, token = '') {
  const ctx = {profile, store: token ? 'standin' : 'sqlite', token, appEnv: {JOB_PILOTTO_E2E_NOTION_BASE_URL: standIn.url, JOB_PILOTTO_E2E_NOTION_STANDIN: '1'}};
  const jobs = await engine(profile, token, 'src.desktop', 'jobs');
  const focus = await engine(profile, token, 'src.focus');
  const interviews = await storeCall(ctx, 'interviews', 'list', {});
  const runs = await storeCall(ctx, 'cron_runs', 'list', {});
  return {
    jobs: named((jobs.jobs || []).map(job => job.company).join('\n')),
    focusKinds: (focus.items || []).map(item => item.kind),   // Why (1 Nov 2026): the seed names no company in Focus's items, so their kinds are what proves the same Focus was handed over
    focus: named((focus.items || []).map(item => [item.title, item.detail, item.company, item.job].join(' ')).join('\n')),
    interviews: interviews.filter(row => /first round/i.test(row.title || row.round || '')).map(() => 'Huxley Systems: first round'),
    activity: runs.filter(run => /4 emails/.test(run.summary || run.result || '')).map(run => run.summary || run.result),
  };
}
const sorted = shown => Object.fromEntries(Object.entries(shown).map(([key, list]) => [key, [...list].sort()]));

test('after the move, the engine serves Jobs, Focus, Interviews and Recent activity the same items from Notion', async () => {
  const {profile, storage} = await install(standIn);
  const before = await screens(profile);
  // The positive control: the seed is what the screens are handed, so "the same after" means something.
  assert.ok(before.jobs.length === 4 && before.interviews.length === 1 && before.activity.length === 1, `the seeded data is not on the screens: ${JSON.stringify(before)}`);
  storage.saveSettings({storeTextsWin: true});
  const done = await moveToNotion(storage, {repair, publish, knowledgePage: knowledgeOnWith(ensureKnowledgePage)(standIn)});
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(settingsOf(profile).store, 'notion', 'the store is not Notion after the move');
  assert.deepEqual(sorted(await screens(profile, standIn.token)), sorted(before), 'the screens differ after the move');
  assert.deepEqual(standIn.stats.unknown, [], 'the stand-in met requests it does not know');
});

test('the export, imported into a fresh install, hands the same items to Jobs, Focus, Interviews and Recent activity (still this Mac\'s store)', async () => {
  const {profile} = await install(standIn);
  const before = await screens(profile);
  assert.ok(before.jobs.length === 4 && before.interviews.length === 1, `the seeded data is not on the screens: ${JSON.stringify(before)}`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-storemove-export-')), 'export.tar.gz');
  await reset.exportTo(profile, file, {version: 'test'});
  assert.ok(fs.existsSync(file) && fs.statSync(file).size > 1000, `Export data wrote no file at ${file}`);
  // A fresh install on its own folder: the Welcome's "Import an export…" stages the file and the restart swaps it in (lib/reset.js).
  const fresh = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-storemove-fresh-')), 'Jobadabra');
  createStorage(fresh, {encrypt: value => value, decrypt: value => value}).saveSettings({store: 'sqlite'});
  await reset.stageImport(fresh, file);
  assert.equal(reset.applyPending(fresh).imported, true);
  assert.equal(settingsOf(fresh).store, 'sqlite', 'the import\'s store is not this Mac\'s');
  assert.deepEqual(sorted(await screens(fresh)), sorted(before), 'the screens differ after the import');
});

test('teardown', async () => { await standIn.close(); });

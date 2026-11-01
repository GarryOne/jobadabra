// Layer 3 (Node + the engine's real SQLite store in a temp folder, no window, no browser): a job dismissed while in process stays out of the In process list (night journey J19; it bounced back to
// "Interview scheduled", 3 Oct 2026). Moved from the e2e `focusdismiss` suite (1 Nov 2026, owner: only Tier 1 journeys are e2e). The app's own `setStatus` handler (lib/focus-handlers.js) runs against
// a real store, the saved list a reload paints first (lib/view-cache.js) and the shared Jobs read (lib/shared-read.js), as in applied-by-hand.test.mjs. The e2e step played the stand-in Notion listing a
// write LATE; here that is a Jobs read that began before the dismissal and answers after it (its answer still lists the job in process). The row leaving the window at once is the renderer's
// (pages/jobs-render.js setStatus -> jobsChanged); this file is what the store, the saved list and the next read say.
// Isolation: the storage is a temp folder, the engine gets only that folder's data and config (lib/pipeline-env.js), its secrets file is the run's own, and no window, Notion, AI or Keychain is reached.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadAppModule} from '../../e2e/lib/app-module.mjs';
import {scenario} from '../../e2e/lib/focus-data.mjs';
import {storeCall} from '../../e2e/lib/store-call.mjs';

const EMBER = 'https://jobs.e2e.test/ember/platform';
const plainCrypto = {encrypt: value => value, decrypt: value => value};
let profile, storage, handlers, pipeline, pipelineRun, viewCache, restore;

before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-dismiss-in-process-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({store: 'sqlite'}));
  // The engine child inherits these: its own secrets file (never the Keychain) and the test marker (lib/pipeline-env.js).
  const kept = {JOB_PILOTTO_E2E: process.env.JOB_PILOTTO_E2E, JOB_PILOTTO_ISOLATED_SECRETS: process.env.JOB_PILOTTO_ISOLATED_SECRETS, HOME: process.env.HOME};
  process.env.JOB_PILOTTO_E2E = '1';
  process.env.JOB_PILOTTO_ISOLATED_SECRETS = path.join(profile, 'isolated-secrets.json');
  process.env.HOME = profile;
  restore = () => { for (const [name, value] of Object.entries(kept)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
  const {createStorage} = await loadAppModule('storage.js');
  const {registerFocusHandlers} = await loadAppModule('focus-handlers.js');
  pipeline = await loadAppModule('pipeline.js');
  pipelineRun = await loadAppModule('pipeline-run.js');
  viewCache = await loadAppModule('view-cache.js');
  storage = createStorage(profile, plainCrypto);
  pipeline.ensureConfig(storage);   // the engine's first-run config copy, as the app makes it at its start
  // The scenario of the e2e Focus suites (e2e/lib/focus-data.mjs), written through the store's own commands (the same as integration/app/screen-store.js seed, which is synchronous).
  const data = scenario(new Date()), made = {};
  for (const {key, fields: {stage, sections = {}, ...job}} of data.rows) {
    made[key] = await call('applications', 'create', {job, stage});
    for (const [name, markdown] of Object.entries(sections)) await call('applications', 'set_section', {app_id: made[key].id, name, markdown});
  }
  for (const {rowKey, kind, at, ...fields} of data.events) await call('events', 'add', {app_id: made[rowKey].id, kind, at, ...fields});
  handlers = new Map();
  registerFocusHandlers({DEMO: false, aiReady: () => true, app: {}, applyTheme: value => value, clearlyTechnical: () => false, here: profile, ipcMain: {handle: (channel, fn) => handlers.set(channel, fn)}, log: () => {},
    needsNotion: () => null, settingsDeps: {}, storage, toWindow: () => {}, track: () => {}});
});
after(() => { restore?.(); fs.rmSync(profile, {recursive: true, force: true}); });

const call = (entity, method, kwargs) => storeCall({profile, store: 'sqlite', token: ''}, entity, method, kwargs);
const ember = list => (list.jobs || []).find(job => job.url === EMBER);
const inProcess = job => !!job && job.stage === 'Interview scheduled';

test('a job dismissed in process stays out of the In process list: Closed in the store, gone from the saved list, not brought back by a late read', async () => {
  const first = await pipeline.jobs(storage, 200);
  assert.ok(inProcess(ember(first)), `the control: Ember Data starts in process (${JSON.stringify(ember(first))})`);
  viewCache.remember(storage, 'jobs', first);   // what the Jobs handler keeps after a read: the list a reload paints first

  // A read that began before the dismissal and answers after it: the store lists the write late. It has its (old) answer from the engine, and waits there until released.
  let release, gotAnswer;
  const gate = new Promise(resolve => { release = resolve; });
  const answered = new Promise(resolve => { gotAnswer = resolve; });
  const late = pipeline.jobs(storage, 200, async (...args) => { const answer = await pipelineRun.run(...args); gotAnswer(); await gate; return answer; });
  await answered;

  const result = await handlers.get('setStatus')({}, EMBER, 'dismissed');
  assert.equal(result?.ok, true, `the app refused: ${result?.error}`);
  assert.equal((await call('applications', 'get', {url: EMBER})).stage, 'Closed', 'the store did not close the dismissed job');

  const painted = ember(viewCache.recall(storage, 'jobs').result);
  assert.ok(!inProcess(painted), `a reload paints the dismissed job in process from the saved list (${JSON.stringify(painted)})`);

  // The reload's own read must not join the late one (shared-read.js: a finished write closes the join).
  // The late read answers right after the reload asked (released here, so a read that joined it ends with the old answer instead of waiting for ever).
  const reloading = pipeline.jobs(storage, 200);
  release();
  const reloaded = await reloading;
  assert.ok(!inProcess(ember(reloaded)), `after a reload the dismissed job is back in process (${JSON.stringify(ember(reloaded))})`);

  assert.ok(inProcess(ember(await late)), 'the control: the late read does list the job in process, so the reload above was proven against a store listing it late');
});

// Layer 3 (Node + the engine's real SQLite store in a temp folder, no window, no browser): "I submitted it" (the session card's button; the app missed the submit, 3 Oct 2026). Pressing it
// marks the job Applied in the store AND ends every session of that job, not only the store row. Moved here from the apply/applyflows e2e step '"I submitted it" marks the job Applied and takes
// its session off the list' (1 Nov 2026, R2): the app's own `setStatus` handler (lib/focus-handlers.js) runs against a real store and the real session list (lib/terminals.js).
// Isolation: the storage is a temp folder, the engine gets only that folder's data and config (lib/pipeline-env.js), its secrets file is the run's own (JOB_PILOTTO_ISOLATED_SECRETS), and no
// window, Notion, AI or Keychain is reached.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadAppModule} from '../../e2e/lib/app-module.mjs';
import {addKitJob, stageOf} from '../../e2e/lib/seed-data.mjs';
import {storeCall} from '../../e2e/lib/store-call.mjs';

const JOB = 'https://jobs.lever.co/e2e-applied-by-hand/4001101';
const OTHER = 'https://jobs.lever.co/e2e-applied-by-hand/4001102';
const plainCrypto = {encrypt: value => value, decrypt: value => value};
let profile, terminals, handlers, restore;

before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-applied-by-hand-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({store: 'sqlite'}));
  // The engine child inherits these: its own secrets file (never the Keychain) and the test marker (lib/pipeline-env.js).
  const kept = {JOB_PILOTTO_E2E: process.env.JOB_PILOTTO_E2E, JOB_PILOTTO_ISOLATED_SECRETS: process.env.JOB_PILOTTO_ISOLATED_SECRETS, HOME: process.env.HOME};
  process.env.JOB_PILOTTO_E2E = '1';
  process.env.JOB_PILOTTO_ISOLATED_SECRETS = path.join(profile, 'isolated-secrets.json');
  process.env.HOME = profile;
  restore = () => { for (const [name, value] of Object.entries(kept)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
  const {createStorage} = await loadAppModule('storage.js');
  const {registerFocusHandlers} = await loadAppModule('focus-handlers.js');
  terminals = await loadAppModule('terminals.js');
  const storage = createStorage(profile, plainCrypto);
  (await loadAppModule('pipeline.js')).ensureConfig(storage);   // the engine's first-run config copy, as the app makes it at its start
  handlers = new Map();
  const ipcMain = {handle: (channel, fn) => handlers.set(channel, fn)};
  registerFocusHandlers({DEMO: false, aiReady: () => true, app: {}, applyTheme: value => value, clearlyTechnical: () => false, here: profile, ipcMain, log: () => {}, needsNotion: () => null,
    settingsDeps: {}, storage, toWindow: () => {}, track: () => {}});
});
after(() => { restore?.(); fs.rmSync(profile, {recursive: true, force: true}); });

const data = (entity, method, kwargs) => storeCall({profile, store: 'sqlite', token: ''}, entity, method, kwargs);
const sessionsOf = url => terminals.list().filter(session => String(session.url || '').replace(/\/$/, '') === url);

test('"I submitted it" marks the job Applied and takes its session off the list, and only that job\'s', async () => {
  terminals._reset();
  const ctx = {data};
  for (const [url, title] of [[JOB, 'Platform Engineer'], [OTHER, 'Site Reliability Engineer']]) {
    await addKitJob(ctx, {title, company: 'E2E Applied By Hand', url, kit: null, stage: 'Applying', nextStep: ''});
    terminals.startForm({id: url === JOB ? 'form-1' : 'form-2', url, title, company: 'E2E Applied By Hand'});
  }
  assert.equal(sessionsOf(JOB).length, 1, 'the control: the job has its session before the press');
  const result = await handlers.get('setStatus')({}, JOB, 'applied');
  assert.equal(result?.ok, true, `the app refused: ${result?.error}`);
  assert.equal(await stageOf(ctx, JOB), 'Applied', 'the store row is not Applied');
  assert.deepEqual(sessionsOf(JOB).map(session => session.id), [], '"I submitted it" left the job\'s session on the list');
  assert.deepEqual(sessionsOf(OTHER).map(session => session.id), ['form-2'], 'another job\'s session was taken off the list');
  assert.notEqual(await stageOf(ctx, OTHER), 'Applied', 'another job became Applied');
});

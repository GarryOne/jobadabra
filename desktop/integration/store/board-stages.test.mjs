// Layer 3 (Node + the engine's real SQLite store in a temp folder, no window, no browser): Jobs → Board shows the store's applications in their stage columns, and a card moved to
// Interviewing writes the stage and its event to the store and is still there after a reload (journey J9, Track an application through its stages). Moved from the e2e `stores` suite
// (1 Nov 2026, owner: "This again should be an integrations"). The Jobs read is the app's own (lib/pipeline.js jobs), the columns are the board's own rule (renderer/jobs-board-rules.js
// boardColumns), the move is the engine step the board's `setStage` handler runs (lib/apply-handlers.js -> pipeline.markOutcome); a "reload" is a fresh read from the store.
// What it does not prove: the click on ⋯ "Move to" in the window (renderer/pages/jobs-board.js moveJob, guarded by test/jobs-board-page.test.js and test/jobs-board-rules.test.js).
// Isolation: the storage is a temp folder, the engine gets only that folder's data and config (lib/pipeline-env.js), its secrets file is the run's own, and no window, Notion, AI or Keychain is reached.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadAppModule} from '../../e2e/lib/app-module.mjs';
import {storeCall} from '../../e2e/lib/store-call.mjs';
import {boardColumns} from '../../renderer/jobs-board-rules.js';

const today = new Date().toISOString().slice(0, 10);
const BOARD = {applied: 'https://jobs.example.test/board-applied', saved: 'https://jobs.example.test/board-saved'};
const plainCrypto = {encrypt: value => value, decrypt: value => value};
let profile, storage, pipeline, restore;

before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-board-stages-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({store: 'sqlite'}));
  // The engine child inherits these: its own secrets file (never the Keychain) and the test marker (lib/pipeline-env.js).
  const kept = {JOBADABRA_E2E: process.env.JOBADABRA_E2E, JOBADABRA_ISOLATED_SECRETS: process.env.JOBADABRA_ISOLATED_SECRETS, HOME: process.env.HOME};
  process.env.JOBADABRA_E2E = '1';
  process.env.JOBADABRA_ISOLATED_SECRETS = path.join(profile, 'isolated-secrets.json');
  process.env.HOME = profile;
  restore = () => { for (const [name, value] of Object.entries(kept)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
  const {createStorage} = await loadAppModule('storage.js');
  pipeline = await loadAppModule('pipeline.js');
  storage = createStorage(profile, plainCrypto);
  pipeline.ensureConfig(storage);   // the engine's first-run config copy, as the app makes it at its start
  await call('applications', 'create', {job: {url: BOARD.applied, title: 'Board Test Engineer', company: 'Example Board Co', applied_on: today}, stage: 'Applied'});
  await call('applications', 'create', {job: {url: BOARD.saved, title: 'Board Saved Engineer', company: 'Example Board Co'}, stage: 'Saved'});
  assert.equal((await call('applications', 'get', {url: BOARD.applied}))?.stage, 'Applied', 'the control: the seed reached the store');
});
after(() => { restore?.(); fs.rmSync(profile, {recursive: true, force: true}); });

const call = (entity, method, kwargs) => storeCall({profile, store: 'sqlite', token: ''}, entity, method, kwargs);
const columnOfUrl = async url => boardColumns((await pipeline.jobs(storage, 200)).jobs || []).find(column => column.jobs.some(job => job.url === url))?.stage;

test('the board shows the store\'s applications in their stage columns', async () => {
  const columns = boardColumns((await pipeline.jobs(storage, 200)).jobs || []);
  assert.equal(columns.length, 15);
  assert.equal(columns[0].stage, 'Recruiter lead');
  assert.equal(columns.at(-1).stage, 'Dismissed');
  assert.equal(await columnOfUrl(BOARD.applied), 'Applied', 'the applied job is not in the Applied column');
  assert.equal(await columnOfUrl(BOARD.saved), 'Saved', 'the saved job is not in the Saved column');
});

test('moving a card to Interviewing writes the stage and its event to the store, and it stays after a reload', async () => {
  // The move: the engine step behind the board's setStage handler (lib/apply-handlers.js).
  const moved = await pipeline.markOutcome(storage, BOARD.applied, 'Interviewing');
  assert.equal(moved?.ok, true, `the store refused the move: ${moved?.error}`);
  const row = await call('applications', 'get', {url: BOARD.applied});
  assert.equal(row?.stage, 'Interviewing', `the store holds ${row?.stage}`);
  assert.ok((await call('events', 'list', {app_id: row.id, kind: 'Interviewing'}))?.length, 'no Interviewing event in the store');

  // A reload reads the store again: the card is in Interviewing, the other one has not moved.
  assert.equal(await columnOfUrl(BOARD.applied), 'Interviewing', 'after a reload the card is not in Interviewing');
  assert.equal(await columnOfUrl(BOARD.saved), 'Saved', 'moving one card moved another');
});

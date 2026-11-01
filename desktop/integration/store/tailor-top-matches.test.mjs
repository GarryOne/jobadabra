// Layer 3 (Node + the engine's real SQLite store in a temp folder, no window, no browser, no AI): "Tailor CVs for top matches" works through the best open jobs without a CV, in fit order, only as
// many as asked (night journey J8, Tier 2 since 1 Nov 2026, so no longer an e2e step). Moved from the e2e `apply` suite's step "Tailor CVs for top matches: asked for 2, it tailors the two best open
// jobs without a CV, in fit order, and leaves the third alone" (R3 follow-up, 1 Nov 2026, owner: only Tier 1 journeys are e2e). What this file runs for real: the store's own commands seed the jobs,
// the shared Jobs read (lib/pipeline.js jobs, which marks `tailored` from the PDFs on this Mac, lib/job-flags.js) lists them, and the picker the handler uses (lib/apply.js pickUntailored) chooses.
// What it does not run: the tailoring itself (AI and Chromium: cv.test.js, cv-inplace*.test.js), the run's card (integration/app/screen-cardstates.test.js "Tailored 3 of 5 CVs, 2 failed"), Run held
// off while a task runs (test/actions-layout.test.js) and "View activity" opening the running task (test/run-view.test.js). The CVs are saved the way the app saves them (cv.save).
// Isolation: the storage is a temp folder, the engine gets only that folder's data and config (lib/pipeline-env.js), its secrets file is the run's own, and no window, Notion, AI or Keychain is reached.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadAppModule} from '../../e2e/lib/app-module.mjs';
import {storeCall} from '../../e2e/lib/store-call.mjs';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
const URL_OF = n => `https://boards.greenhouse.io/e2e-top/jobs/90000${n}`;
let profile, storage, pipeline, apply, cv, restore;

const call = (entity, method, kwargs) => storeCall({profile, store: 'sqlite', token: ''}, entity, method, kwargs);
const titles = list => list.map(job => job.title);
const read = async () => (await pipeline.jobs(storage, 200)).jobs;
// The jobs the picker may take, as the shared read lists them (an applied job is not open, so it is never picked whatever its fit).
const open = jobs => jobs.filter(job => job.url?.includes('e2e-top'));

before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tailor-top-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({store: 'sqlite'}));
  // The engine child inherits these: its own secrets file (never the Keychain) and the test marker (lib/pipeline-env.js).
  const kept = {JOBADABRA_E2E: process.env.JOBADABRA_E2E, JOBADABRA_ISOLATED_SECRETS: process.env.JOBADABRA_ISOLATED_SECRETS, HOME: process.env.HOME};
  process.env.JOBADABRA_E2E = '1';
  process.env.JOBADABRA_ISOLATED_SECRETS = path.join(profile, 'isolated-secrets.json');
  process.env.HOME = profile;
  restore = () => { for (const [name, value] of Object.entries(kept)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
  const {createStorage} = await loadAppModule('storage.js');
  pipeline = await loadAppModule('pipeline.js');
  apply = await loadAppModule('apply.js');
  cv = await loadAppModule('cv.js');
  storage = createStorage(profile, plainCrypto);
  pipeline.ensureConfig(storage);   // the engine's first-run config copy, as the app makes it at its start
  // Three open jobs at fit 99, 98 and 97, written through the store's own commands, as the e2e step wrote them; a fourth, already Applied, at fit 100 (not open: never a pick).
  for (const [index, fit] of [99, 98, 97].entries()) {
    const made = await call('applications', 'create', {job: {url: URL_OF(index + 1), title: `Platform Engineer ${index + 1}`, company: `E2E Top ${index + 1}`, location: 'Zurich, Switzerland'}, stage: 'Kit ready'});
    await call('applications', 'update', {app_id: made.id, fields: {fit}});
  }
  const applied = await call('applications', 'create', {job: {url: URL_OF(9), title: 'Platform Engineer Applied', company: 'E2E Top Applied', location: 'Zurich, Switzerland'}, stage: 'Applied'});
  await call('applications', 'update', {app_id: applied.id, fields: {fit: 100}});
});
after(() => { restore?.(); fs.rmSync(profile, {recursive: true, force: true}); });

const record = job => ({job: {code: job.code, url: job.url, title: job.title, company: job.company}, createdAt: '2026-11-01T00:00:00.000Z', model: cv.MODEL, usd: 0, changes: [], warnings: [], cv: {}, review: {}});

test('asked for 2, it takes the two best open jobs without a CV in fit order and leaves the third alone; asked again, it takes the third; with every CV made there is nothing to do', async () => {
  const listed = open(await read());
  const at = title => listed.find(job => job.title === title);
  assert.deepEqual(['Platform Engineer 1', 'Platform Engineer 2', 'Platform Engineer 3', 'Platform Engineer Applied'].map(title => [at(title)?.fit, at(title)?.tailored]), [[99, false], [98, false], [97, false], [100, false]],
    'the control: the three open jobs and the applied one are listed at their fits, none with a CV');

  const picked = apply.pickUntailored(await read(), 2);
  assert.deepEqual(titles(picked), ['Platform Engineer 1', 'Platform Engineer 2'], 'asked for 2 it must take the fit 99 and the fit 98 job, in that order, never the applied job at fit 100 nor the third');

  // The two CVs are made (what the run does for each): the next read marks exactly those two, the picker leaves them out.
  for (const job of picked) cv.save(storage, job.code, record(job), Buffer.from(`%PDF-1.4 TAILORED CV for ${job.company}`));
  const after = open(await read());
  assert.deepEqual(after.filter(job => job.title.startsWith('Platform Engineer ') && !job.title.endsWith('Applied')).map(job => [job.title, job.tailored]),
    [['Platform Engineer 1', true], ['Platform Engineer 2', true], ['Platform Engineer 3', false]], 'the Jobs read must show the CV on the two tailored jobs only');
  assert.deepEqual(titles(apply.pickUntailored(await read(), 2)), ['Platform Engineer 3'], 'asked again, only the job still without a CV is left to take');

  const third = after.find(job => job.title === 'Platform Engineer 3');
  cv.save(storage, third.code, record(third), Buffer.from('%PDF-1.4 TAILORED CV for E2E Top 3'));
  const everything = await read();
  assert.deepEqual(apply.pickUntailored(everything, 2), [], 'with every open job tailored there is nothing to pick');
  assert.equal(apply.nothingToTailor(everything), 'Every one of your best matches already has a tailored CV.');
});

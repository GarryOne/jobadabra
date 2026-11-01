// Layer 3 (Node + the real engine + the Notion stand-in, no window): a job the app has just written stays written while Notion still lists its old stage (#2758, the owner's "a dismissed job
// comes back as Interview scheduled after a quick reload"; this is journey J19's proof since the e2e `focusdismiss` suite left the PR run, 1 Nov 2026). The stand-in lists a write LATE (notion-fake
// setLag), as real Notion does (up to ~2 min on CI). The app side is the real one: lib/jobs-handlers.js ('jobs' = the fresh read, 'cached' = the saved list every load paints first),
// lib/focus-handlers.js ('setStatus', 'deleteJob') and lib/pipeline-commands.js (setStatus, deleteJob, unapply, notSubmitted: where the app's writes are held, whoever asks), with the real view cache (lib/view-cache.js) and the real engine behind them;
// only ipcMain is a map of handlers. Data comes from the engine's own commands (e2e/lib/focus-data.mjs scenario).
// Each case: the start state is written with the lag OFF, then the lag goes on (a row's listing is frozen at that moment), the write is made, and the job must read as written
// (1) in a read made inside the lag (it began after the write), (2) in the saved list, (3) after the lag ends, in both.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {addFocusData, scenario} from '../../e2e/lib/focus-data.mjs';
import {startEngineKit} from './engine-kit.mjs';

const at = name => `https://jobs.e2e.test/${name}`;
const LAG_MS = 10 * 60 * 1000;   // longer than the test: the listing never catches up unless the test says so
let kit, handlers, pipeline;
const call = (name, ...args) => handlers.get(name)({}, ...args);
const find = (list, url) => (list?.jobs || []).find(job => job.url === url);
const shown = (list, url) => { const job = find(list, url); return job ? `${job.status}/${job.stage}` : 'not listed'; };
const saved = () => call('cached', 'jobs')?.result;

before(async () => {
  kit = await startEngineKit({ai: false, store: 'notion'});
  await addFocusData({data: kit.data}, scenario(new Date()));
  pipeline = kit.tasks;
  handlers = new Map();
  const ipcMain = {handle: (name, fn) => handlers.set(name, fn)};
  const shared = {DEMO: false, JOBS_PAGE: 200, activity: () => [], aiGate: async () => null, allowanceBlock: async () => null, app: {getPath: () => kit.profile, setLoginItemSettings() {}},
    cloud: () => false, dispatchCloud: async () => ({ok: false}), here: kit.profile, ipcMain, log() {}, needsNotion: () => null, shell: {}, storage: kit.storage, toWindow() {}, track() {},
    aiReady: () => true, applyTheme: value => value, clearlyTechnical: () => false, settingsDeps: {}};
  (await import('../../lib/jobs-handlers.js')).registerJobsHandlers(shared);
  (await import('../../lib/focus-handlers.js')).registerFocusHandlers(shared);
});
after(async () => { await kit?.close(); });

// [what the person did, the job (scenario row), the state before (lag off), the write, how the job must read afterwards]
const CASES = [
  {what: 'Dismiss a job in process (#2758)', job: 'ember/platform', write: url => call('setStatus', url, 'dismissed'), reads: list => shown(list, at('ember/platform')) === 'dismissed/Closed'},
  {what: 'Save a job with a kit ready', job: 'birch/platform', write: url => call('setStatus', url, 'saved'), reads: list => shown(list, at('birch/platform')) === 'saved/Saved'},
  {what: 'A session\'s Skip (pipeline.setStatus called directly, not the row\'s menu)', job: 'kestrel/principal', write: url => pipeline.setStatus(kit.storage, url, 'dismissed'), reads: list => shown(list, at('kestrel/principal')) === 'dismissed/Closed'},
  {what: 'Mark a job Applied', job: 'alder/sre', write: url => call('setStatus', url, 'applied'), reads: list => shown(list, at('alder/sre')) === 'applied/Applied'},
  {what: '"This wasn\'t submitted" on an Applied job', job: 'cedar/devops', write: url => pipeline.notSubmitted(kit.storage, url), reads: list => shown(list, at('cedar/devops')) === 'applied/Applying'},
  {what: 'A session ended without a submission (Applying back to Kit ready)', job: 'delta/sre', before: url => pipeline.notSubmitted(kit.storage, url), write: url => pipeline.unapply(kit.storage, url),
    reads: list => shown(list, at('delta/sre')) === 'unreviewed/Kit ready'},
  {what: 'Delete a dismissed job', job: 'ibis/infra', before: url => call('setStatus', url, 'dismissed'), write: url => call('deleteJob', url), reads: list => shown(list, at('ibis/infra')) === 'not listed'},
];

for (const one of CASES) {
  test(`${one.what}: the job reads as written in a read made inside Notion's listing lag, in the saved list, and after the lag ends`, async () => {
    const url = at(one.job);
    kit.notion.fake.setLag(0);
    if (one.before) assert.equal((await one.before(url))?.ok, true, 'the start state was not written');
    assert.ok(find(await call('jobs', {}), url), `${one.job} should be listed before the write`);

    kit.notion.fake.setLag(LAG_MS);   // from here Notion lists every write late
    const written = await one.write(url);
    assert.equal(written?.ok, true, `the write was not saved: ${JSON.stringify(written)}`);

    const problems = [];
    const check = (where, list) => { if (!one.reads(list)) problems.push(`${where}: ${shown(list, url)}`); };
    const inside = await call('jobs', {});   // a reload inside the lag: this read began after the write
    check('a read made inside the lag', inside);
    check('the saved list (painted first on every load) inside the lag', saved());

    kit.notion.fake.setLag(0);   // Notion catches up
    check('the saved list after the lag ends, before any fresh read (what the next load paints first)', saved());
    check('a fresh read after the lag ends', await call('jobs', {}));
    check('the saved list after that fresh read', saved());
    assert.deepEqual(problems, [], 'the job does not read as written');
  });
}

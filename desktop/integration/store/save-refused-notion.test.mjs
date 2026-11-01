// Layer 3 (Node + the real engine + the Notion stand-in behind the fault proxy, no window): a Save that Notion refuses is never shown as saved. Moved from the e2e suite failuresnotion
// (1 Nov 2026, owner: "All Notion-only steps"): the step "a Save that Notion refuses is never shown as saved: the person is told in words, and Notion and the list still agree".
// The engine writes Notion first and changes nothing when that fails (src/desktop.py), so the person is told, the row in Notion is as it was and the Jobs list does not claim the job is saved
// (a silent loss here is a job the person thinks they kept, 5 Oct 2026). The app side is the real one: lib/focus-handlers.js 'setStatus' → lib/pipeline-commands.js setStatus (with the real view
// cache), lib/jobs-handlers.js 'jobs' and 'cached'; only ipcMain is a map of handlers. Data comes from the engine's own commands (e2e/lib/focus-data.mjs scenario).
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {addFocusData, scenario} from '../../e2e/lib/focus-data.mjs';
import {startEngineKit} from './engine-kit.mjs';

const URL_OF = 'https://jobs.e2e.test/birch/platform';   // a job with a kit ready, not saved yet
let kit, handlers;
const call = (name, ...args) => handlers.get(name)({}, ...args);
const listed = list => (list?.jobs || []).find(job => job.url === URL_OF);
const shown = list => { const job = listed(list); return job ? `${job.status}/${job.stage}` : 'not listed'; };

before(async () => {
  kit = await startEngineKit({ai: false, store: 'notion'});
  await addFocusData({data: kit.data}, scenario(new Date()));
  handlers = new Map();
  const ipcMain = {handle: (name, fn) => handlers.set(name, fn)};
  const shared = {DEMO: false, JOBS_PAGE: 200, activity: () => [], aiGate: async () => null, allowanceBlock: async () => null, app: {getPath: () => kit.profile, setLoginItemSettings() {}},
    cloud: () => false, dispatchCloud: async () => ({ok: false}), here: kit.profile, ipcMain, log() {}, needsNotion: () => null, shell: {}, storage: kit.storage, toWindow() {}, track() {},
    aiReady: () => true, applyTheme: value => value, clearlyTechnical: () => false, settingsDeps: {}};
  (await import('../../lib/jobs-handlers.js')).registerJobsHandlers(shared);
  (await import('../../lib/focus-handlers.js')).registerFocusHandlers(shared);
});
after(async () => { await kit?.close(); });

test('a Save that Notion refuses is never shown as saved: the person is told in words, and Notion and the list still agree', async () => {
  const before = shown(await call('jobs', {}));
  assert.notEqual(before, 'not listed', 'positive control: the job is in the Jobs list before the Save');
  assert.ok(!/^saved\//.test(before), `positive control: the job is not saved yet (${before})`);
  const failedBefore = kit.notion.stats.failed;

  kit.notion.fail('server-error', {writes: true});
  let result;
  try { result = await call('setStatus', URL_OF, 'saved').catch(error => ({ok: false, error: error.message})); } finally { kit.notion.pass(); }
  assert.ok(kit.notion.stats.failed - failedBefore >= 1, 'Notion was never asked while refusing, so nothing was tested');

  const after = shown(await call('jobs', {}));
  const problems = [];
  if (result?.ok) problems.push('the app answered "saved" though Notion refused the write: a silent loss');
  if (after !== before) problems.push(`the job reads "${after}" after a refused Save, it read "${before}" before`);
  if (/^saved\//.test(shown(call('cached', 'jobs')?.result))) problems.push('the saved list shows the job as saved though the save failed');
  if (/<!DOCTYPE|internal_server_error|"object":|Traceback/.test(String(result?.error || ''))) problems.push('the message for the person carries Notion\'s raw answer');
  if (!String(result?.error || '').trim()) problems.push('the person is told nothing: the answer has no words');
  assert.deepEqual(problems, [], `answer ${JSON.stringify(result).slice(0, 200)}`);
});

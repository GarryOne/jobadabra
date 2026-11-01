// The night red (run 41253960704, 1 Nov 2026): a refresh the window starts during "Move my data to Notion" (a real `python -m src.stores call` on this Mac's store)
// opened the store after the archive renamed it away and made a new empty data/tracker.sqlite beside a Notion store. The move saves store=notion first, then waits
// for the engine runs already running, then archives. Guards lib/engine-runs-in-flight.js, store-move.js, pipeline-run.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as inFlight from '../lib/engine-runs-in-flight.js';
import * as pipelineRun from '../lib/pipeline-run.js';
import * as engine from '../lib/store/engine.js';
import {moveToNotion} from '../lib/store-move.js';

const storageOn = settings => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-late-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({...settings, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile-page'}});
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  return storage;
};
// Isolated like test/store-call-private.test.js: no .env, never the Desktop App's folder; the store is the one under test.
const engineOn = store => (s, args, onLine, extra, options) => pipelineRun.run(s, args, onLine,
  {...extra, JOB_PILOTTO_STORE: store, JOB_PILOTTO_FOLLOW_APP: '0', JOB_PILOTTO_NO_DOTENV: '1', NOTION_TOKEN: ''}, options);
const ready = async () => { await new Promise(setImmediate); };   // one turn of the event loop: whatever is already runnable has run

test('settled() waits for the runs in flight at the call, never for runs asked for after it', async () => {
  let finish = () => {}, ended = false;
  inFlight.track(new Promise(resolve => { finish = resolve; }).then(() => { ended = true; }));
  const states = [];
  const waiting = inFlight.settled().then(() => states.push('settled'));
  let later = () => {};
  inFlight.track(new Promise(resolve => { later = resolve; }));   // asked for after the call: must not hold it
  await ready();
  assert.deepEqual(states, [], 'still waiting for the run in flight');
  finish();
  await waiting;
  assert.ok(ended && states.length === 1);
  later();
});

test('a run no watchdog bounds (a sign-in waiting on a person) never holds settled()', async () => {
  inFlight.track(new Promise(() => {}), {bounded: false});   // never ends, as a Google sign-in left open
  await inFlight.settled();
  assert.ok(true, 'settled() came back although an unbounded run is still in flight');
});

test('a read the window starts during the move ends before the archive: no tracker.sqlite is left beside a Notion store', async () => {
  const storage = storageOn({store: 'sqlite'});
  const sqlite = engineOn('sqlite');
  await engine.call(storage, 'applications', 'list', {}, {run: sqlite});   // the engine makes this Mac's store, as in use
  assert.ok(fs.existsSync(storage.path('data/tracker.sqlite')), 'positive control: the engine made the store');
  fs.mkdirSync(storage.path('data/files'), {recursive: true});
  const refreshes = [];
  const copy = async (_s, _args, onLine) => { onLine('moving applications 1/1'); return {code: 0, stdout: '{"moved": {"applications": 1}}'}; };
  const publish = async () => { refreshes.push(engine.call(storage, 'applications', 'list', {}, {run: sqlite})); };   // the window's refresh, started with this Mac's store
  const result = await moveToNotion(storage, {repair: async (_t, ids) => ({ids}), run: copy, publish, now: new Date('2026-11-01T00:00:00Z')});
  await Promise.all(refreshes);
  assert.equal(result.ok, true);
  assert.equal(storage.settings().store, 'notion');
  assert.ok(!fs.existsSync(storage.path('data/tracker.sqlite')), 'still in use on this Mac after the move: data/tracker.sqlite');
  assert.ok(fs.existsSync(path.join(result.archive, 'data', 'tracker.sqlite')), 'the archive holds the store');
});

// Jobs, Focus and Strategy show their last good read at once, then the fresh one (lib/view-cache.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeEach, test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as viewCache from '../lib/view-cache.js';

const storage = () => {
  const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cache-')), {encrypt: v => v, decrypt: v => v});
  s.saveSettings({notionIds: {NOTION_APPLICATIONS_DB: 'ws-1'}, viewCache: true});
  return s;
};

beforeEach(() => viewCache.releaseHeldWrites());   // the ledger of the app's own recent writes is per process

test('a good read is kept and handed back; errors and out-of-date lists are not kept', () => {
  const s = storage();
  assert.equal(viewCache.recall(s, 'jobs'), null);
  viewCache.remember(s, 'jobs', {jobs: [{title: 'SRE'}], total: 1});
  assert.deepEqual(viewCache.recall(s, 'jobs').result, {jobs: [{title: 'SRE'}], total: 1});
  viewCache.remember(s, 'jobs', {jobs: [], stale: true});  // Notion unreachable: the good one stays
  viewCache.remember(s, 'focus', {ok: false, error: 'Notion down'});
  assert.equal(viewCache.recall(s, 'jobs').result.total, 1);
  assert.equal(viewCache.recall(s, 'focus'), null);
  assert.equal(viewCache.recall(s, '../settings'), null);  // only the three screens
});

test("another Notion workspace never sees this one's saved screens", () => {
  const s = storage();
  viewCache.remember(s, 'strategy', {ok: true, roles: ['SRE']});
  s.saveSettings({notionIds: {NOTION_APPLICATIONS_DB: 'ws-2'}});
  assert.equal(viewCache.recall(s, 'strategy'), null);
});

test('saved screens live in their own folder, not Chromium\'s Cache (same name on a case-insensitive Mac disk)', () => {
  const s = storage();
  viewCache.remember(s, 'focus', {ok: true, focus: {}});
  assert.ok(fs.existsSync(s.path('view-cache/focus.json')));
  assert.ok(!fs.existsSync(s.path('cache')));
});

test('while the view cache is off, screens load fresh (nothing handed back), but reads are still saved', () => {
  const s = storage();
  s.saveSettings({viewCache: false});
  viewCache.remember(s, 'jobs', {jobs: [], total: 0});
  assert.equal(viewCache.recall(s, 'jobs'), null);
  s.saveSettings({viewCache: true});
  assert.equal(viewCache.recall(s, 'jobs').result.total, 0);
});

test('the view cache is on unless settings say "viewCache": false', () => {
  const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cache-')), {encrypt: v => v, decrypt: v => v});
  s.saveSettings({notionIds: {NOTION_APPLICATIONS_DB: 'ws-1'}});  // never set: on
  viewCache.remember(s, 'focus', {ok: true, focus: {items: []}});
  assert.ok(viewCache.recall(s, 'focus'));
  s.saveSettings({viewCache: false});
  assert.equal(viewCache.recall(s, 'focus'), null);
});

test('a status write shows in the saved Jobs list and drops the saved Focus: a reload never brings back a dismissed job', () => {
  const s = storage();
  viewCache.remember(s, 'jobs', {jobs: [{url: 'https://x/ember', status: 'applied', stage: 'Interview scheduled'}, {url: 'https://x/alder', status: 'unreviewed', stage: ''}]});
  viewCache.remember(s, 'focus', {ok: true, focus: {}});
  const at = viewCache.recall(s, 'jobs').at;
  viewCache.statusChanged(s, 'https://x/ember', 'dismissed', 'Closed');
  const saved = viewCache.recall(s, 'jobs');
  assert.deepEqual(saved.result.jobs[0], {url: 'https://x/ember', status: 'dismissed', stage: 'Closed'});
  assert.equal(saved.result.jobs[1].status, 'unreviewed');
  assert.equal(saved.at, at);  // still says how old the read is
  assert.equal(viewCache.recall(s, 'focus'), null);
  viewCache.statusChanged(s, 'https://x/alder', 'saved');  // no Notion: the status alone
  assert.deepEqual(viewCache.recall(s, 'jobs').result.jobs[1], {url: 'https://x/alder', status: 'saved', stage: ''});
});

test('clearing the job list drops the saved Jobs list and Focus: no start paints the cleared jobs back', () => {
  const s = storage();
  viewCache.remember(s, 'jobs', {jobs: [{url: 'https://x/ember', status: 'unreviewed', stage: ''}]});
  viewCache.remember(s, 'focus', {ok: true, focus: {}});
  viewCache.jobsCleared(s);
  assert.equal(viewCache.recall(s, 'jobs'), null);
  assert.equal(viewCache.recall(s, 'focus'), null);
});

// 7 Oct 2026: Strategy's `stale` counts jobs waiting for a new score; a read with one was never kept, so every visit painted a copy
// from the morning (old places, remote Yes) before the fresh read. Only `stale: true` (a list from the cache) is refused.
test('a Strategy read with jobs waiting for a new score is kept', () => {
  const s = storage();
  viewCache.remember(s, 'strategy', {ok: true, lists: {country: [{fragment: 'Switzerland'}]}, remote_jobs: true, stale: 0});
  viewCache.remember(s, 'strategy', {ok: true, lists: {country: [{fragment: 'Romandie'}]}, remote_jobs: false, stale: 2594});
  const kept = viewCache.recall(s, 'strategy').result;
  assert.deepEqual([kept.lists.country[0].fragment, kept.remote_jobs], ['Romandie', false]);
});

// #2758: Notion lists a write late, so a Jobs read that began AFTER a write can still carry the old stage; pipeline.jobs shows it as written (withHeldWrites), then the handler saves it
// (journey proof: integration/store/job-write-lag.test.mjs). These are the ledger's rules.
const read = (s, jobs, total = jobs.length) => viewCache.remember(s, 'jobs', viewCache.withHeldWrites(s, {jobs, total}));
const stageOf = (s, url) => viewCache.recall(s, 'jobs').result.jobs.find(job => job.url === url);

test('a Jobs read that still lists the old stage is shown and saved as written, until the store lists the written value', () => {
  const s = storage(), url = 'https://x/ember';
  read(s, [{url, status: 'applied', stage: 'Interview scheduled'}]);
  viewCache.statusChanged(s, url, 'dismissed', 'Closed');
  const late = read(s, [{url, status: 'applied', stage: 'Interview scheduled'}]);
  assert.deepEqual([late.jobs[0].status, late.jobs[0].stage], ['dismissed', 'Closed'], 'the window gets the written state');
  assert.deepEqual([stageOf(s, url).status, stageOf(s, url).stage], ['dismissed', 'Closed'], 'the saved list has the written state');
  read(s, [{url, status: 'dismissed', stage: 'Closed'}]);   // the store caught up: the hold ends
  assert.equal(read(s, [{url, status: 'applied', stage: 'Offer'}]).jobs[0].stage, 'Offer', 'a change made elsewhere afterwards is not hidden');
});

test('a change made elsewhere before the store caught up is not hidden: only a state the job had before is replaced', () => {
  const s = storage(), url = 'https://x/alder';
  read(s, [{url, status: 'unreviewed', stage: 'Kit ready'}]);
  viewCache.statusChanged(s, url, 'saved', 'Saved');
  assert.equal(read(s, [{url, status: 'unreviewed', stage: 'Kit ready'}]).jobs[0].stage, 'Saved', 'the old listing is replaced by what was written');
  assert.equal(read(s, [{url, status: 'applied', stage: 'Applying'}]).jobs[0].stage, 'Applying', 'Apply (written by the engine or the extension) is a newer state');
  assert.equal(read(s, [{url, status: 'unreviewed', stage: 'Kit ready'}]).jobs[0].stage, 'Kit ready', 'and the hold ended with it');
});

test('with no saved list to read the prior state from, the first listing after the write is the stale one and a newer change is not hidden', () => {
  const s = storage(); s.saveSettings({viewCache: false});   // recall() is null: no prior state known
  const url = 'https://x/ember';
  viewCache.statusChanged(s, url, 'dismissed', 'Closed');
  assert.equal(read(s, [{url, status: 'applied', stage: 'Interview scheduled'}]).jobs[0].stage, 'Closed', 'the first listing, from before the write, is replaced');
  assert.equal(read(s, [{url, status: 'applied', stage: 'Interview scheduled'}]).jobs[0].stage, 'Closed', 'and so is the next one');
  assert.equal(read(s, [{url, status: 'applied', stage: 'Offer'}]).jobs[0].stage, 'Offer', 'a newer state is shown, and the hold ends');
});

test('two writes inside the lag: the listing from before either of them is still replaced by the last one', () => {
  const s = storage(), url = 'https://x/ember';
  read(s, [{url, status: 'applied', stage: 'Interview scheduled'}]);
  viewCache.statusChanged(s, url, 'dismissed', 'Closed');
  viewCache.statusChanged(s, url, 'applied', 'Applying');
  assert.equal(read(s, [{url, status: 'applied', stage: 'Interview scheduled'}]).jobs[0].stage, 'Applying');
  assert.equal(read(s, [{url, status: 'dismissed', stage: 'Closed'}]).jobs[0].stage, 'Applying', 'the first write, listed late, is stale too');
});

test('a deleted job is dropped from a Jobs read that still lists it, and the count follows', () => {
  const s = storage(), url = 'https://x/gone';
  viewCache.jobDeleted(s, url);
  const late = read(s, [{url, status: 'dismissed', stage: 'Closed'}, {url: 'https://x/other', status: 'saved', stage: 'Saved'}], 2);
  assert.deepEqual(late.jobs.map(job => job.url), ['https://x/other']);
  assert.equal(late.total, 1);
});

test('a hold ends after ten minutes, and never reaches another Notion workspace', t => {
  const s = storage(), url = 'https://x/ember', old = {url, status: 'applied', stage: 'Interview scheduled'};
  read(s, [{...old}]);
  viewCache.statusChanged(s, url, 'dismissed', 'Closed');
  const other = storage(); other.saveSettings({notionIds: {NOTION_APPLICATIONS_DB: 'ws-2'}});
  assert.equal(read(other, [{...old}]).jobs[0].stage, 'Interview scheduled', 'another workspace is not touched');
  t.mock.timers.enable({apis: ['Date'], now: Date.now() + 10 * 60000 + 1});
  assert.equal(read(s, [{...old}]).jobs[0].stage, 'Interview scheduled', 'ten minutes later the store is believed');
});

// A session's form tab is known by (browser run, tab id), never by its address, and survives every restart but Chrome's own
// (owner, 8 Oct 2026: an extension update and an app restart left the open Coop form showing "Form closed" for good).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test, beforeEach} from 'node:test';
import * as review from '../lib/review.js';
import {snapshot, startRun} from '../../extension/tab-memory.js';

const coop = {id: 's1', url: 'https://jobs.coop.ch/Coop/job/Nyon-Assistante/1405093533/', company: 'Coop Suisse', status: 'ended', startedAt: '2026-10-08T13:09:15Z'};
const form = (tab, boot, extra = {}) => ({url: 'https://career2.successfactors.eu/careers?company=Coop#jobpilotto-fill', title: 'Career Opportunities', tab, boot, session: 's1', left: 13, total: 19, ...extra});
const RUN = '1759928000000', NEXT = '1759990000000';
let file;
beforeEach(() => { review._reset(); file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tabs-')), 'review-states.json'); review.persist(file, ['s1']); });

test('the app restarts: the session knows its tab at once, and the next tab report says open or closed', () => {
  review.noteTabs({ids: [812], boot: RUN});
  review.report([coop], form(812, RUN));
  review._reset(); review.persist(file, ['s1']);           // a new app process
  assert.equal(review.tabOpen('s1'), null);               // no tab report yet: not known
  review.noteTabs({ids: [5, 812], boot: RUN});
  assert.equal(review.tabOpen('s1'), true);
  review.noteTabs({ids: [5], boot: RUN});
  assert.equal(review.tabOpen('s1'), false);              // you closed it
});

test('the extension reloads (its own update, or ↻ by hand): its tab memory and run id come back, the form stays open', () => {
  const items = {boot: RUN, 'session:812': 's1', 'armed:812': true, 'job:812': coop.url};
  const tabs = [{id: 812, url: 'https://career2.successfactors.eu/careers?company=Coop#jobpilotto-fill'}, {id: 9, url: 'https://www.youtube.com/'}];
  const kept = snapshot(items, tabs, 1000);
  assert.deepEqual(kept.tabs, {812: 'career2.successfactors.eu'});   // only the tabs it remembers something about
  const run = startRun({kept, tabsNow: tabs});               // no time limit: a reload by hand hours later is the same run
  assert.equal(run.boot, RUN);
  assert.deepEqual(run.restore, items);
  review.noteTabs({ids: [812, 9], boot: RUN});
  review.report([coop], form(812, RUN));
  review.noteTabs({ids: [812, 9], boot: RUN});              // the reloaded extension's first report: same run
  assert.equal(review.tabOpen('s1'), true);
});

test('Chrome restarts: a new run, the old tab id means nothing, and the form is closed until a tab of the new run reports', () => {
  const kept = snapshot({boot: RUN, 'session:812': 's1'}, [{id: 812, url: 'https://career2.successfactors.eu/x'}]);
  assert.equal(startRun({kept, sawStartup: true, tabsNow: [{id: 812, url: 'https://career2.successfactors.eu/x'}]}).boot, '');
  assert.equal(startRun({kept, tabsNow: [{id: 812, url: 'https://www.google.com/'}]}).boot, '');   // no onStartup, but its tabs are gone
  assert.equal(startRun({kept: undefined}).boot, '');
  review.noteTabs({ids: [812], boot: RUN, browser: 'chrome-a'});
  review.report([coop], form(812, RUN));
  review.noteTabs({ids: [3, 812], boot: NEXT, browser: 'chrome-a'});   // the same browser, a new run: tab 812 of it is some other page
  assert.equal(review.tabOpen('s1'), false);
  const answer = review.report([coop], form(3, NEXT));     // the form, restored by Chrome as tab 3: not "older" than 812
  assert.equal(answer.matched, 's1');
  assert.equal(review.tabOpen('s1'), true);
});

test('the tab report alone binds a session to the tab carrying it, and a restarted app keeps it', () => {
  review.noteTabs({ids: [812], boot: RUN, sessions: {812: 's1', 813: 'gone'}}, new Set(['s1']));
  assert.equal(review.tabOpen('s1'), true);
  assert.equal(review.tabOpen('gone'), null);               // not a session of this app
  review.report([coop], form(812, RUN));                     // a state on disk to carry the binding
  review._reset(); review.persist(file, ['s1']);
  review.noteTabs({ids: [812], boot: RUN});
  assert.equal(review.tabOpen('s1'), true);
});

test('an address never makes a form look closed: no tab known and none that looks like it is "not known"', () => {
  review.noteTabs({ids: [812], boot: RUN});
  review.report([coop], form(812, RUN));
  assert.deepEqual(review.formStates(['s1', 's2', 's3'], new Set(['s3'])), {ids: ['s1', 's3'], unsure: ['s2']});
  review.noteTabs({ids: [], boot: RUN});
  assert.deepEqual(review.formStates(['s1', 's2'], new Set()), {ids: [], unsure: ['s2']});   // s1: its own tab closed
});

// Two browsers with the extension, each saying what IT has open (8 Oct 2026: a test Chrome paired to the owner's app reported no tabs
// every few seconds, and the owner's open Coop form flipped to "Form closed"). As a matrix: who reports, and what the card says.
test('a second browser never closes the first one\'s form; a browser gone quiet, or restarted, does', () => {
  let now = 0;
  review._clock(() => now);
  const owner = ids => review.noteTabs({ids, boot: RUN, browser: 'owner'});
  const tester = () => review.noteTabs({ids: [], boot: NEXT, browser: 'test'});
  owner([812]);
  review.report([coop], form(812, RUN));
  const cases = [
    ['the owner\'s browser has it', () => {}, true],
    ['a test browser with no tabs reports after it', () => tester(), true],
    ['and again, 60 s later (the owner\'s still within 90 s)', () => { now += 60 * 1000; tester(); }, true],
    ['the owner\'s reports again: still open', () => { owner([812]); tester(); }, true],
    ['the owner closes the tab', () => owner([5]), false],
    ['the owner\'s tab is back (another report)', () => owner([5, 812]), true],
    ['the owner\'s browser goes quiet past 90 s while the test one reports', () => { now += 91 * 1000; tester(); }, false],
  ];
  for (const [name, step, want] of cases) { step(); assert.equal(review.tabOpen('s1'), want, name); }
  // An older extension (no browser id): each run is its own entry, gone after 90 s silent.
  review._reset(); review.persist(file, ['s1']); now = 0; review._clock(() => now);
  review.noteTabs({ids: [812], boot: RUN});
  review.report([coop], form(812, RUN));
  review.noteTabs({ids: [], boot: NEXT});
  assert.equal(review.tabOpen('s1'), true, 'older extension: another run does not close it');
  now += 91 * 1000; review.noteTabs({ids: [], boot: NEXT});
  assert.equal(review.tabOpen('s1'), false, 'older extension: its run silent past 90 s');
});

// 9 Oct 2026 (twin log 12:37:19): the app reopened Nahrin's jobs.ch form while Coop's tab was in front; the new tab inherited Coop's session
// from its opener for 10 ms, a tab report in between moved Coop onto it, and Coop's open form looked closed once that tab closed.
test('a tab that carried a session for one report only gives it back when the next report shows it carries another', () => {
  const known = new Set(['coop', 'nahrin']);
  const moves = []; review.onBind(move => moves.push(move));
  review.noteTabs({ids: [255], boot: RUN, sessions: {255: 'coop'}}, known);
  review.noteTabs({ids: [255, 256], boot: RUN, sessions: {255: 'coop', 256: 'coop'}}, known);   // the inherited session, for a moment
  assert.equal(moves.at(-1).tab, 256);
  review.noteTabs({ids: [255, 256], boot: RUN, sessions: {255: 'coop'}}, known);                // the fill mark dropped it
  assert.deepEqual([moves.at(-1).id, moves.at(-1).tab, moves.at(-1).by], ['coop', 255, 'tab report: its tab carries another session now']);
  review.noteTabs({ids: [255], boot: RUN, sessions: {255: 'coop'}}, known);                     // the jobs.ch tab closes: Coop's form is still open
  assert.equal(review.tabOpen('coop'), true);
  review.noteTabs({ids: [255, 257], boot: RUN, sessions: {255: 'coop', 257: 'nahrin'}}, known);
  assert.equal(review.tabOpen('nahrin'), true);
  assert.equal(review.tabOpen('coop'), true);
});

test('a session bound by its page keeps its tab even when the tab report carries nothing for it (an older extension, a form page)', () => {
  review.report([coop], form(812, RUN));
  review.noteTabs({ids: [700, 812], boot: RUN, sessions: {700: 's1'}}, new Set(['s1']));   // an older tab of it: never pulls it back
  assert.equal(review.olderTab('s1', 700, RUN), true);
  assert.equal(review.tabOpen('s1'), true);
});

// A worker waking with empty session storage (idle ~30 s, or a reload): the posting a tab was opened for (from:) and its session come back with the memory, so the page
// after Apply still has its kit. Held on 14 Oct 2026 when the sibling gap (a tab opened while the worker booted, settle-tabs.js) was fixed.
test('a worker waking with empty storage gets each tab\'s posting and session back', () => {
  const items = {boot: RUN, 'from:7': 'https://boards.example/jobs/1', 'session:7': 'ca582c3c', 'armed:7': true};
  const tabs = [{id: 7, url: 'https://boards.example/jobs/1#jobpilotto-fill=ca582c3c'}];
  const run = startRun({kept: snapshot(items, tabs, 1000), tabsNow: tabs});
  assert.equal(run.boot, RUN);
  assert.equal(run.restore['from:7'], 'https://boards.example/jobs/1');
  assert.equal(run.restore['session:7'], 'ca582c3c');
});

// 27 Oct 2026 (the panel-tailor journey step): a tab report taken before the app opened a form says nothing about that new tab. The session page showed "The form tab was closed" (then
// "Checking Chrome…") for up to 30 s, with no "Before you submit" card, while the form was open and filling. The form page's own report proves its tab open.
test('a form page that just reported has its tab open while every tab report is older than its tab; a newer report decides', () => {
  let now = 1000;
  review._clock(() => now);
  review.noteTabs({ids: [5], boot: RUN});                  // the report before the form tab existed
  now = 2000;
  review.report([coop], form(812, RUN));                   // the new tab's page reports
  assert.equal(review.tabOpen('s1'), true, 'its page just reported');
  now = 13000;
  assert.equal(review.tabOpen('s1'), null, 'the page went quiet and no tab report saw it yet: not known, never closed');
  review.noteTabs({ids: [5, 812], boot: RUN});
  assert.equal(review.tabOpen('s1'), true);
  now = 14000;
  review.noteTabs({ids: [5], boot: RUN});                  // a report after the bind without it: closed
  assert.equal(review.tabOpen('s1'), false);
});

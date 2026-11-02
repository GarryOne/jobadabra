// Technical reports (lib/telemetry.js): scrubbed before they leave the Mac, queued, sent in batches, off means off.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {create, event, scrub} from '../lib/telemetry.js';

test('nothing personal or secret leaves the Mac', () => {
  const text = scrub('Error at /Users/igor/Library/x.js for igor.m@gmail.com, key sk-ant-api03-abcdef, token ntn_12345678901234567890, '
    + 'call +41 79 123 45 67, see https://jobs.example.com/apply?email=a%40b.c&id=9#frag, bot 1234567890:AAabcdefghijklmnopqrstuvwxyz1234', 500, '/Users/igor');
  for (const leak of ['igor', 'gmail', 'sk-ant', 'ntn_', '79 123', 'email=', '#frag', 'AAabcdef']) assert.ok(!text.includes(leak), `${leak} in: ${text}`);
  assert.match(text, /~\/Library\/x\.js/);
  assert.match(text, /https:\/\/jobs\.example\.com\/apply/);  // the site stays: it's what a form issue is about
});

test('an event carries its fields scrubbed, and who/what/when without identity', () => {
  const item = event('run_failed', {job: 'prep', error: 'JSONDecodeError in /Users/igor/x', seconds: 73, cutOff: true},
    {install: 'id-1', version: '0.4.1', platform: 'darwin', osVersion: '25.3.0', now: Date.parse('2026-09-29T16:00:00Z')});
  assert.deepEqual([item.kind, item.install, item.version, item.seconds, item.cutOff], ['run_failed', 'id-1', '0.4.1', 73, true]);
  assert.ok(!item.error.includes('igor'));
});

function fakeStorage(settings = {}) {
  const files = {};
  return {settings: () => settings, saveSettings: next => Object.assign(settings, next), readText: name => files[name], writeText: (name, text) => { files[name] = text; }};
}

test('events queue on the Mac, go out in batches, and are removed once the server took them', async () => {
  const storage = fakeStorage();
  const posts = [];
  const telemetry = create(storage, {version: '0.4.1', fetcher: async (url, init) => { posts.push(JSON.parse(init.body).events.length); return {ok: true}; }});
  for (let i = 0; i < 60; i++) telemetry.record('crash', {message: `boom ${i}`});
  assert.equal(await telemetry.flush(), 60);
  assert.deepEqual(posts, [50, 10]);
  assert.equal(await telemetry.flush(), 0);  // nothing left
  assert.equal(telemetry.shown().length, 20);  // the last 20, for "See what's sent"
  assert.ok(storage.settings().telemetryId);  // a random install ID, made once
});

test('offline: kept for the next try; off: nothing recorded, the queue dropped', async () => {
  const storage = fakeStorage();
  const telemetry = create(storage, {version: '1', fetcher: async () => { throw new Error('offline'); }});
  telemetry.record('crash', {message: 'x'});
  assert.equal(await telemetry.flush(), 0);
  storage.saveSettings({telemetry: false});
  assert.equal(telemetry.record('crash', {message: 'y'}), null);
  let called = false;
  const off = create(storage, {version: '1', fetcher: async () => { called = true; return {ok: true}; }});
  assert.equal(await off.flush(), 0);
  assert.equal(called, false);
});

test('finished runs are counted per app version and taken (then reset) by the health line', () => {
  const storage = fakeStorage({telemetryRuns: {version: '0.4.0', ok: 9, failed: 9}});  // an older version's counts
  const telemetry = create(storage, {version: '0.4.1', fetcher: async () => ({ok: true})});
  telemetry.countRun(true); telemetry.countRun(true); telemetry.countRun(false);
  assert.deepEqual(telemetry.takeRuns(), {runsOk: 2, runsFailed: 1});
  assert.deepEqual(telemetry.takeRuns(), {runsOk: 0, runsFailed: 0});
  storage.settings().telemetry = false;
  telemetry.countRun(true);
  assert.deepEqual(telemetry.takeRuns(), {runsOk: 0, runsFailed: 0});
});

test('every report says which channel the install came from, once the installer left one (a label, shown in See what\'s sent)', async () => {
  const storage = fakeStorage();
  const sent = [];
  const telemetry = create(storage, {version: '0.4.2', fetcher: async (url, init) => { sent.push(...JSON.parse(init.body).events); return {ok: true}; }});
  telemetry.record('health', {});
  storage.saveSettings({installSource: 'reddit-devops'});
  telemetry.record('health', {});
  telemetry.record('health', {source: 'hn'});   // an event's own field is not overwritten
  await telemetry.flush();
  assert.deepEqual(sent.map(item => item.source), [undefined, 'reddit-devops', 'hn']);
});

test('a source run reports only when JOBADABRA_TELEMETRY asks for it: "0" (the e2e harness) means no', async () => {
  const {sourceRunReports} = await import('../lib/telemetry.js');
  for (const off of [undefined, '', '0', 'off', 'OFF', 'false', 'no', ' 0 ']) assert.equal(sourceRunReports({JOBADABRA_TELEMETRY: off}), false, `${off}`);
  for (const on of ['1', 'on', 'true', 'yes']) assert.equal(sourceRunReports({JOBADABRA_TELEMETRY: on}), true, on);
  assert.equal(sourceRunReports({}), false);
});

test('a test run never reports: CI, the end-to-end journey and an explicit "0" are off; a dev build opts in with a real value', async () => {
  const {reportingOff} = await import('../lib/telemetry.js');
  assert.equal(reportingOff({}, {packaged: true}), '');   // an installed app reports (if the user's switch is on)
  assert.equal(reportingOff({}, {packaged: false}), 'a development build');
  assert.equal(reportingOff({JOBADABRA_TELEMETRY: '1'}, {packaged: false}), '');   // a developer who wants to see reports
  assert.equal(reportingOff({JOBADABRA_TELEMETRY: '0'}, {packaged: false}), 'a development build');   // "0" is off, not a value (8 test runs counted as installs on 2 Oct 2026)
  assert.equal(reportingOff({JOBADABRA_TELEMETRY: 'off'}, {packaged: false}), 'a development build');
  for (const flag of ['JOBADABRA_E2E', 'CI', 'GITHUB_ACTIONS', 'JOBADABRA_SMOKE', 'JOBADABRA_PTY_SMOKE']) {
    assert.match(reportingOff({[flag]: '1', JOBADABRA_TELEMETRY: '1'}, {packaged: true}), /test|CI|journey|smoke/i, flag);
  }
});

test('in the end-to-end journey on CI only Sentry may report: the store stays silent even if its switch is on, and the id is the fixed "e2e"', async () => {
  const {sentryOnly, create} = await import('../lib/telemetry.js');
  assert.equal(sentryOnly({JOBADABRA_E2E: '1', GITHUB_ACTIONS: 'true'}), true);
  assert.equal(sentryOnly({JOBADABRA_E2E: '1'}), false, 'a local run reports nothing at all');
  assert.equal(sentryOnly({GITHUB_ACTIONS: 'true'}), false, 'another CI job is not the journey');
  const files = new Map(), settings = {};
  const storage = {settings: () => settings, saveSettings: patch => Object.assign(settings, patch), readText: name => files.get(name) || '', writeText: (name, text) => files.set(name, text)};
  const silent = create(storage, {version: '1.0', silent: true});
  assert.equal(silent.enabled(), false);
  assert.equal(silent.record('crash', {summary: 'x'}), null);
  assert.equal(files.size, 0, 'nothing queued, nothing to send');
  assert.equal(create(storage, {version: '1.0'}).enabled(), true, 'the normal store is unchanged');
});

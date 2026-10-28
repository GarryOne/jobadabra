// lib/live-view-handlers.js: the app screen's thin connection to the live view core (hosted/ready-fill/live.mjs attachLive). Fakes only: no browser,
// no window, no file but the test's own. A session's events reach the window tagged with its id; the window's input reaches only that session;
// a file is answered only from the person's CV or the app's own Open dialog.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {registerLiveViewHandlers} from '../lib/live-view-handlers.js';

function setup({page = async id => (id === 's1' ? 'ws://127.0.0.1:9/devtools/page/A' : null), DEMO = false, picked = null} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-live-')), handles = new Map(), sent = [], attached = [], closed = [];
  const storage = {path: name => path.join(root, name)};
  registerLiveViewHandlers({DEMO, storage, ipcMain: {handle: (name, fn) => handles.set(name, fn)}, toWindow: (channel, payload) => sent.push([channel, payload]),
    page, getWindow: () => null, dialog: {showOpenDialog: async () => (picked ? {canceled: false, filePaths: [picked]} : {canceled: true, filePaths: []})},
    openCdp: async url => ({url, detach: async () => closed.push(url)}),
    attach: async (channel, cdp, options) => { const row = {channel, cdp, options, inputs: []}; channel.onMessage(message => row.inputs.push(message)); channel.onClose(() => closed.push('channel')); attached.push(row); }});
  return {root, handles, sent, attached, closed, call: (name, ...args) => handles.get(name)(null, ...args)};
}

test('opening a session attaches its held tab; its events reach the window tagged with the session; input reaches only it', async () => {
  const s = setup();
  assert.deepEqual(await s.call('liveOpen', 's1'), {ok: true});
  assert.equal(s.attached[0].cdp.url, 'ws://127.0.0.1:9/devtools/page/A');
  s.attached[0].channel.send({kind: 'frame', data: 'jpeg'});
  assert.deepEqual(s.sent, [['liveEvent', {session: 's1', message: {kind: 'frame', data: 'jpeg'}}]]);
  await s.call('liveInput', 's1', {t: 'key', key: 'a'});
  await s.call('liveInput', 's2', {t: 'key', key: 'b'});
  assert.deepEqual(s.attached[0].inputs, [{t: 'key', key: 'a'}]);
  await s.call('liveClose', 's1');
  assert.ok(s.closed.includes('channel'));
  await s.call('liveInput', 's1', {t: 'key', key: 'c'});
  assert.equal(s.attached[0].inputs.length, 1, 'a closed view takes no input');
});

test('a session with no held tab, or the demo app, opens nothing', async () => {
  assert.equal((await setup().call('liveOpen', 'other')).ok, false);
  const demo = setup({DEMO: true});
  assert.equal((await demo.call('liveOpen', 's1')).ok, false);
  assert.equal(demo.attached.length, 0);
});

test('opening again replaces the old view: one stream per session', async () => {
  const s = setup();
  await s.call('liveOpen', 's1');
  await s.call('liveOpen', 's1');
  assert.equal(s.attached.length, 2);
  assert.ok(s.closed.includes('channel'), 'the first view was closed');
});

test('a file comes only from the person\'s CV or the app\'s own Open dialog, never a path the window sends', async () => {
  const picked = path.join(os.tmpdir(), 'Fictional-Other-CV.pdf');
  const s = setup({picked});
  await s.call('liveOpen', 's1');
  const resolve = s.attached[0].options.resolveFile;
  assert.equal(await resolve('cv'), null, 'no CV saved yet');
  fs.writeFileSync(path.join(s.root, 'cv.pdf'), '%PDF-1.4 fictional\n');
  assert.equal(await resolve('cv'), path.join(s.root, 'cv.pdf'));
  assert.equal(await resolve('pick'), picked);
  assert.equal(await resolve('/etc/hosts'), null);
  const cancelled = setup();
  await cancelled.call('liveOpen', 's1');
  assert.equal(await cancelled.attached[0].options.resolveFile('pick'), null);
});

// The app's Submit (owner's live view design, 28 Oct 2026): the person's press on the page's own sending button, off while a required field is empty.
function submitRig({control = 'Envoyer', facts = {fields: 3, filled: 3, left: [], active: ''}, pressed = {ok: true}} = {}) {
  const handles = new Map(), presses = [], detached = [], logs = [];
  registerLiveViewHandlers({storage: {path: name => name}, ipcMain: {handle: (name, fn) => handles.set(name, fn)}, toWindow: () => {}, dialog: {}, log: (...args) => logs.push(args),
    page: async id => (id === 's1' ? 'ws://127.0.0.1:9/devtools/page/A' : null), submitControl: async id => (id === 's1' ? control : ''),
    openCdp: async url => ({url, detach: async () => detached.push(url)}),
    core: {pageFacts: async () => facts, pressText: async (_cdp, text) => { presses.push(text); return pressed; }}});
  return {presses, detached, logs, submit: id => handles.get('liveSubmit')(null, id)};
}
test('Submit presses the button the form judge named, only when the page has no required field left, and lets the page go', async () => {
  const s = submitRig();
  assert.deepEqual(await s.submit('s1'), {ok: true});
  assert.deepEqual(s.presses, ['Envoyer']);
  assert.equal(s.detached.length, 1);
  assert.ok(JSON.stringify(s.logs).includes('pressed'), 'the press is logged (never a value)');
  const left = submitRig({facts: {fields: 3, filled: 1, left: [{label: 'Last name'}, {label: 'CV'}], active: ''}});
  const refused = await left.submit('s1');
  assert.deepEqual([refused.ok, refused.left], [false, 2]);
  assert.match(refused.error, /2 required fields/);
  assert.deepEqual(left.presses, []);
});
test('Submit presses nothing without the judge\'s ready, without a held tab, on a page it cannot read, or for the demo app', async () => {
  const noJudge = submitRig({control: ''});
  assert.equal((await noJudge.submit('s1')).ok, false);
  assert.equal((await submitRig().submit('s2')).ok, false);
  const unread = submitRig({facts: null});
  assert.equal((await unread.submit('s1')).ok, false);
  for (const rig of [noJudge, unread]) assert.deepEqual(rig.presses, []);
  const handles = new Map();
  registerLiveViewHandlers({DEMO: true, storage: {path: n => n}, ipcMain: {handle: (n, fn) => handles.set(n, fn)}, toWindow: () => {}, dialog: {}, page: async () => 'ws://x', submitControl: async () => 'Envoyer'});
  assert.equal((await handles.get('liveSubmit')(null, 's1')).ok, false);
});
test('a covered or vanished button is said in words the person can act on', async () => {
  assert.match((await submitRig({pressed: {ok: false, why: 'covered'}}).submit('s1')).error, /covers/);
  assert.match((await submitRig({pressed: {ok: false, why: 'not_found'}}).submit('s1')).error, /page's own/);
});

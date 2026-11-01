// #2536: only the person's browser describes Chrome's extension; the app-owned hidden browser's check-ins never do. Its own file: server.js keeps check-in state per process, and extension-store-id.test.js asserts the state before any check-in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {logTo} from '../lib/log.js';
import {logText} from './log-text.mjs';

// Keep the real server, version wording and IPC decisions; cut off all native browser operations.
registerHooks({load(url, context, next) {
  if (url === new URL('../lib/dev-extension-version.js', import.meta.url).href) return {format: 'module', shortCircuit: true, source: "export const devVersion = () => '0.9.701';"};
  if (url === new URL('../lib/extension-ready.js', import.meta.url).href) return {format: 'module', shortCircuit: true, source: 'export const extensionReady = async () => ({waited: 0});'};
  if (url === new URL('../lib/form-tab.js', import.meta.url).href) return {format: 'module', shortCircuit: true, source: `
    export const ATS = /jobs\\.test/;
    export const openFormTab = async () => 'tab'; export const listTabs = async () => [];
    export const reloadFormTab = async () => 'no-tab';
    export const closeFormTab = () => { throw Error('no real browser'); };
    export const focusTabAt = closeFormTab; export const focusTabById = closeFormTab;
  `};
  return next(url, context);
}});

const FOLDER = 'gpffoneapcfceflfmfgedkcfbommgcfk';   // the manifest key's ID (Load unpacked)
const freePort = () => new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });

// #2536: the owner's current Chrome and Full automation's base-version copy alternate every 30 seconds.
test('only the person\'s copy controls the older note and repair decisions', async t => {
  process.env.JOBADABRA_PORT = String(await freePort());
  const server = await import('../lib/server.js');
  assert.notEqual(server.PORT, 47111, 'never the owner\'s app socket');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-browser-versions-'));
  const storage = createStorage(dir, {encrypt: s => s, decrypt: s => s});
  assert.ok(storage.dir.startsWith(os.tmpdir()), 'only temporary app data, no owner profile or Keychain');
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(new URL(url).origin, `http://127.0.0.1:${server.PORT}`, 'no network or live app beyond this test server');
    return realFetch(url, options);
  });
  const running = server.start(storage, error => assert.fail(error));
  await once(running, 'listening');
  t.after(() => new Promise(resolve => running.close(resolve)));
  t.after(() => { logTo(null); fs.rmSync(dir, {recursive: true, force: true}); });
  logTo(dir);
  const handles = new Map(), ipcMain = {handle: (name, fn) => handles.set(name, fn)};
  const {registerApplyHandlers} = await import('../lib/apply-handlers.js');
  const {registerBrowserHandlers} = await import('../lib/browser-handlers.js');
  const review = await import('../lib/review.js');
  registerApplyHandlers({ipcMain, storage, DEMO: false, here: path.resolve(import.meta.dirname, '..')});
  registerBrowserHandlers({ipcMain, storage});
  const session = {id: 'version-form', url: 'https://jobs.test/version'};
  // A panel picks up actual queued commands; no Chrome, profile, form navigation or real process exists.
  const reload = async () => {
    const pending = handles.get('reviewReload')({}, session.id, session.url);
    const answer = review.report([session], {session: session.id, url: session.url, total: 1, left: 0});
    return {result: await pending, commands: answer.commands};
  };
  const focus = async () => {
    const pending = handles.get('reviewFocus')({}, session.id, '', session.url);
    await setImmediate();
    review.report([session], {session: session.id, url: session.url, total: 1, left: 0});
    return pending;
  };
  const report = async (browser, version, owned) => {
    const response = await fetch(`http://127.0.0.1:${server.PORT}/extension/tabs`, {method: 'POST',
      headers: {Origin: `chrome-extension://${FOLDER}`, Authorization: `Bearer ${server.extensionToken(storage)}`},
      body: JSON.stringify({browser, boot: `${browser}-boot`, worker: `${browser}-worker`, ids: [], urls: [], version, owned})});
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.latest, '0.9.701');
    assert.equal(answer.build.behind, {'0.9': null, '0.9.701': 0, '0.9.600': 101}[version], 'the build reply describes this reporter');
    return answer;
  };
  const current = async (known = true) => {
    const seen = handles.get('extensionSeen')();
    assert.equal(seen?.note || '', '', 'Applying and Settings have no older note');
    assert.equal(server.staleExtension(server.extensionSeen()?.version || '', '0.9.701'), '');
    assert.equal((await focus()).outdated, false);
    if (known) {
      assert.equal(seen.version, '0.9.701');
      const answer = await reload();
      assert.equal(answer.result.result, 'reloaded', 'current Chrome uses the panel reload');
      assert.deepEqual(answer.commands, [{reload: true}]);
    } else {
      assert.equal(seen, null, 'a hidden-only report says nothing about Chrome');
      assert.equal((await reload()).result.extension, '');
    }
  };
  await t.test('hidden first: current Chrome never gets an older note', async () => {
    await report('hidden', '0.9', true);
    await current(false);
    await report('chrome', '0.9.701', false);
    await current();
    for (let i = 0; i < 3; i++) {
      await report('hidden', '0.9', true);
      await current();
      await report('chrome', '0.9.701', false);
      await current();
    }
    const lines = logText(path.join(dir, 'app.log')).split('\n').filter(line => line.includes('checked in:'));
    assert.equal(lines.length, 2, 'one first check-in per browser; no version flips on repeated reports');
    assert.match(lines[0], /"browser":"hidden","owned":true/);
    assert.match(lines[1], /"browser":"chrome","owned":false/);
  });

  await t.test('Chrome first, then hidden, then Chrome: current after every report', async () => {
    for (const [browser, version, owned] of [['chrome-2', '0.9.701', false], ['hidden-2', '0.9', true], ['chrome-2', '0.9.701', false]]) {
      await report(browser, version, owned);
      await current();
    }
    const all = logText(path.join(dir, 'app.log')).split('\n').filter(line => line.includes('checked in:'));
    assert.equal(all.length, 4, 'each new browser logs once, repeated Chrome does not');
  });
  await t.test('a genuinely old Chrome still gets the note and old-copy repair', async () => {
    await report('chrome', '0.9.600', false);
    assert.match(handles.get('extensionSeen')().note, /0\.9\.600, older.*0\.9\.701: reload it once/);
    assert.equal((await focus()).outdated, true);
    const answer = await reload();
    assert.equal(answer.result.outdated, true);
    assert.deepEqual(answer.commands, [], 'an old panel gets no reload command it cannot handle');
  });
});

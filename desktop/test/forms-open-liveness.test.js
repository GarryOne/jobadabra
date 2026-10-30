// Any reporting browser keeps pooled form knowledge alive, while Chrome's version notes stay specific to the person's copy (#2536).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {extensionReady} from '../lib/extension-ready.js';
import {createTabExpect, WINDOW_MS} from '../lib/tab-expect.js';

// Keep the HTTP server, form binding and IPC handler real; no native browser operation may run.
registerHooks({load(url, context, next) {
  if (url === new URL('../lib/form-tab.js', import.meta.url).href) return {format: 'module', shortCircuit: true, source: `
    export const ATS = /jobs\\.test/;
    export const listTabs = async () => [];
    export const openFormTab = () => { throw Error('no real browser'); };
    export const reloadFormTab = openFormTab; export const closeFormTab = openFormTab;
    export const focusTabAt = openFormTab; export const focusTabById = openFormTab;
  `};
  return next(url, context);
}});

test('form knowledge and readiness follow any browser, independently of Chrome version identity', async t => {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  process.env.JOB_PILOTTO_PORT = String(probe.address().port);
  await new Promise(resolve => probe.close(resolve));
  const server = await import('../lib/server.js');
  assert.notEqual(server.PORT, 47111, 'never the owner\'s app port');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-form-liveness-'));
  const storage = createStorage(dir, {encrypt: s => s, decrypt: s => s});
  assert.ok(storage.dir.startsWith(os.tmpdir()), 'only temporary data; no owner profile or Keychain');
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(new URL(url).origin, `http://127.0.0.1:${server.PORT}`, 'only this test server; no live app, AI or external network');
    return realFetch(url, options);
  });
  const running = server.start(storage, error => assert.fail(error));
  await once(running, 'listening');
  t.after(() => new Promise(resolve => running.close(resolve)));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const {registerApplyHandlers} = await import('../lib/apply-handlers.js');
  const review = await import('../lib/review.js'), terminals = await import('../lib/terminals.js');
  const handles = new Map();
  registerApplyHandlers({ipcMain: {handle: (name, fn) => handles.set(name, fn)}, storage, DEMO: false});
  server.setTabsHandler(report => { review.noteTabs(report); return []; });
  t.after(() => { review._reset(); terminals._reset(); server.setTabsHandler(() => []); });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);

  for (const [browser, owned, version] of [['hidden', true, '0.9'], ['chrome', false, '0.9.701']]) await t.test(`only ${browser} reports: forms are known and open`, async () => {
    now += 90001;
    server.openTabs();   // no surviving report from the other browser
    review._reset(); terminals._reset();
    const session = terminals.startForm({id: `${browser}-form`, url: 'https://jobs.test/version'});
    const response = await fetch(`http://127.0.0.1:${server.PORT}/extension/tabs`, {method: 'POST',
      headers: {Origin: `chrome-extension://${server.EXTENSION_ID}`, Authorization: `Bearer ${server.extensionToken(storage)}`},
      body: JSON.stringify({browser, boot: `${browser}-boot`, worker: `${browser}-worker`, owned, version,
        urls: [session.url], ids: [41], sessions: {41: session.id}})});
    assert.equal(response.status, 200);
    await response.json();
    assert.deepEqual(server.openTabs(), [session.url]);
    assert.deepEqual(await handles.get('formsOpen')(), {known: true, ids: [session.id], unsure: []}, 'a reporting hidden browser is as valid as Chrome for form knowledge');
    assert.deepEqual(server.extensionHeard(), {at: now});
    assert.deepEqual(await extensionReady(server.extensionHeard, {sleep: () => assert.fail('a reporting browser must not wait 35 seconds')}), {waited: 0, seen: true});
    assert.equal(server.extensionSeen()?.version || '', owned ? '' : '0.9.701', 'liveness never supplies a hidden version to Chrome notes');
    const records = [];
    const tracker = createTabExpect({now: () => now, record: row => records.push(row), isBound: () => false,
      isLive: () => true, extensionSeen: server.extensionHeard});
    tracker.expect('unbound-form');
    for (let elapsed = 0; elapsed < WINDOW_MS; elapsed += 5000) { now += 5000; tracker.tick(); }
    assert.deepEqual(records.map(row => row.outcome), ['tab_not_taken'], 'a reporting browser is not misreported as silent');
  });

  await t.test('silent pooled tabs expire after 90 seconds', async () => {
    now += 90001;
    assert.deepEqual(server.openTabs(), []);
    assert.deepEqual(await handles.get('formsOpen')(), {known: false, ids: []});
  });
});

// The app-with-a-fake-browser kit of layer 3 (Node, no window): the REAL extension server (lib/server.js), the app's extension wiring (lib/ext-server-handlers.js), the apply and session handlers and the
// session store (lib/terminals.js, lib/review.js) run on a temp install; the browser is a recorder and the extension is an HTTP client of the server, sending what the real one sends (/extension/tabs,
// /extension/review) with the extension's token and origin. Created for the apply and applyflows rows that left e2e (R3, 1 Nov 2026): a closed form tab and Reopen, a second browser, two applications side by side.
// Job: serve stored answers
//
// What it never does: open a browser or script Chrome (lib/form-tab.js is replaced by a stub that lists no tabs and focuses none: on a Mac the real one drives the person's Chrome), reach the owner's
// folders (a fresh temp storage), reach a network (every fetch must go to the kit's own loopback server), or use port 47111 (asserted). `open`, the door the app opens a form tab through, is the kit's
// recorder: `browser.opened` lists each address with its fill mark.
// One kit per test FILE (node --test runs each file in its own process): it sets process.env and registers module hooks, which the app's modules read at import.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {freePort} from '../../e2e/lib/own-port.mjs';
// Why (1 Nov 2026, R3): own-port.mjs, not engine-kit's freePort: engine-kit imports e2e/lib modules that need playwright-core, which the CI `app` job does not install; own-port.mjs needs only node:net.

// Why (1 Nov 2026, R3): the same stub the unit test desktop/test/forms-open-liveness.test.js uses; the real lib/form-tab.js runs `osascript` against the person's Chrome on a Mac.
registerHooks({load(url, context, next) {
  if (url === new URL('../../lib/form-tab.js', import.meta.url).href) return {format: 'module', shortCircuit: true, source: `
    export const ATS = /jobs\\.test/;
    export const listTabs = async () => [];
    export const openFormTab = async () => 'none'; export const reloadFormTab = async () => 'no-chrome'; export const closeFormTab = async () => false;
    export const focusTabAt = async () => false; export const focusTabById = async () => false;
  `};
  return next(url, context);
}});

const noop = () => {};

/**
 * Starts a kit: the server on a free loopback port, the app's wiring on a temp storage, and the recorder browser.
 * -> {server, storage, call(route, body) (a POST as the extension sends it), apply, applyOne(url, details, id), terminals, review, handlers (the ipc handlers by name), browser, extension(options), close()}.
 * `browser.open` is the `open` the app's spawn door takes; `browser.opened` the addresses it was given. `extension({browser, boot})` is one browser's extension: `.report(tabs)` sends /extension/tabs,
 * `.reviewReport(payload)` sends /extension/review (what a form tab's panel sends); `tabs` is [{id, url, session?}].
 */
export async function startSessionKit({settings = {}} = {}) {
  const port = await freePort();
  Object.assign(process.env, {JOBADABRA_PORT: String(port), JOBADABRA_E2E: '1', JOBADABRA_E2E_OPENER: 'fake-opener'});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-session-kit-'));
  const {createStorage} = await import('../../lib/storage.js');
  const storage = createStorage(dir, {encrypt: text => text, decrypt: text => text});
  assert.ok(storage.dir.startsWith(os.tmpdir()), 'only temporary data; no owner profile or Keychain');
  storage.saveSettings({store: 'sqlite', ...settings});
  const server = await import('../../lib/server.js');
  assert.notEqual(server.PORT, 47111, 'never the owner\'s app port');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    assert.equal(new URL(String(url)).origin, `http://127.0.0.1:${server.PORT}`, 'only the kit\'s server; no live app, AI or outside network');
    return realFetch(url, options);
  };
  const [apply, terminals, review, {registerExtServerHandlers}, {registerApplyHandlers}, {registerSessionHandlers}] = await Promise.all([
    import('../../lib/apply.js'), import('../../lib/terminals.js'), import('../../lib/review.js'), import('../../lib/ext-server-handlers.js'),
    import('../../lib/apply-handlers.js'), import('../../lib/session-handlers.js')]);
  terminals._reset(); review._reset();
  terminals.usePty(async () => ({spawn: () => ({onData: noop, onExit: noop, write: noop, resize: noop, kill: noop})}));
  const handlers = new Map(), sent = [];
  const ipcMain = {handle: (name, fn) => handlers.set(name, fn), on: noop};
  const toWindow = (channel, payload) => sent.push({channel, payload});
  const browser = {opened: [], open(command, args) { browser.opened.push(String(args.at(-1))); return {on: noop, unref: noop}; }};   // JOBADABRA_E2E_OPENER: ['node', [opener, ...urls]]
  // main.js builds the session flow once, from the same pieces (the stage from each report, the hand-over): the kit's differ only in what reaches outside (no Claude, no notice, no tab to close).
  const {createSessionFlow} = await import('../../lib/session-flow.js');
  let sessionFlow = null;
  const flow = () => (sessionFlow ||= createSessionFlow({terminals, review, apply, appLog: noop, toWindow, startClaude: async () => ({ok: false}), claudeAllowed: () => false, offerNotice: noop, closeTab: noop}));
  registerExtServerHandlers({DEMO: false, app: {}, createWindow: noop, cvOf: () => null, flow, ipcMain, notify: noop, readSites: () => [], scoreVisitJobs: noop, sessionNeedsYou: () => false,
    storage, getTelemetry: () => null, toWindow, getWindow: () => null, setRecipeReporter: noop});
  registerApplyHandlers({ipcMain, storage, DEMO: false, here: path.resolve(import.meta.dirname, '..', '..'), toWindow, track: noop, log: noop, allowanceBlock: async () => null, claudeConsent: async () => false,
    needsNotion: () => null, prepareKitFor: async () => ({ok: true}), startClaude: async () => ({ok: false}), getRecipeReporter: () => null, cloud: null});
  // The session handlers see the REAL openOne with the kit's recorder as its door (the same call apply-handlers makes for an Apply).
  registerSessionHandlers({ipcMain, appLog: noop, storage, getWindow: () => null, here: path.resolve(import.meta.dirname, '..', '..'), DEMO: false, nativeImage: {createFromPath: () => ({})},
    dialog: {showMessageBox: async () => ({response: 0})}, apply: {...apply, openOne: (url, options = {}) => apply.openOne(url, {...options, open: browser.open}),
      applyOne: (store, url, details = {}) => apply.applyOne(store, url, details, {open: browser.open, run: async () => ({code: 0})})},
    focusTab: async () => 'none', review, pipeline: {}, server, notion: {}, claudeConsent: async () => false});
  const running = server.start(storage, error => assert.fail(error));
  await new Promise(resolve => running.once('listening', resolve));
  const call = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.PORT}${route}`, {method: 'POST', headers: {Origin: `chrome-extension://${server.EXTENSION_ID}`, Authorization: `Bearer ${server.extensionToken(storage)}`}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});   // a hang guard: the server answers in milliseconds, so this names the route that hung
    assert.equal(response.status, 200, `${route} answered ${response.status}`);
    return response.json();
  };
  /** One browser with the extension: its own run id (`boot`), its tabs reported as the real worker does. */
  const extension = ({browser: name = 'chrome', boot = `${name}-boot`, owned = false} = {}) => ({
    report: tabs => call('/extension/tabs', {browser: name, boot, worker: `${name}-worker`, owned, version: '0.9.701', urls: tabs.map(tab => tab.url.split('#')[0]), ids: tabs.map(tab => tab.id),
      sessions: Object.fromEntries(tabs.filter(tab => tab.session).map(tab => [tab.id, tab.session]))}),
    reviewReport: payload => call('/extension/review', {boot, ...payload}),
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise(resolve => running.close(resolve));
    globalThis.fetch = realFetch;
    terminals._reset(); review._reset(); server.setTabsHandler(() => []);
    fs.rmSync(dir, {recursive: true, force: true});
  };
  /** The Apply press for a job: a form session, and the form tab opened through the recorder (lib/apply.js applyOne with the kit's door; the store write behind it is not played). */
  const applyOne = (url, details = {}, id = undefined) => apply.applyOne(storage, url, details, {open: browser.open, run: async () => ({code: 0}), ...(id ? {id: () => id} : {}), focus: async () => 'none'});
  return {server, storage, call, apply, applyOne, terminals, review, handlers, browser, extension, sent, close};
}

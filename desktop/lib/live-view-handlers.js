// The app screen's thin connection to a hidden-browser session's live view (spec 2026-10-27-background-apply-execution, step B): the core is
// hosted/ready-fill/live.mjs attachLive (any channel, any CDP session); here the channel is the window's IPC, so a phone viewer later reuses the
// core with its own channel. Guards: test/ipc.test.js (every call handled), test/live-view-handlers.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from './root.js';
import {openCdpSession} from './cdp-session.js';
import {openFrameTargets} from './frame-targets.js';
import {CV_FILES} from '../renderer/cv-files.js';

const liveModule = () => import(pathToFileURL(path.join(ROOT, 'hosted', 'ready-fill', 'live.mjs')).href);

/** "Open in my browser": the hand-off of the hidden tab at `address` (live.mjs handoffOf), read over its own short CDP session. */
export async function readHandoff(address, openCdp = openCdpSession) {
  const cdp = await openCdp(address);
  try { return await (await liveModule()).handoffOf(cdp); } finally { await cdp.detach().catch(() => {}); }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const PRESS_FAILED = {covered: 'Something on the page covers its Submit button. Close it in the live page, then press Submit again.',
  not_found: 'The page\'s Submit button is not where it was. Use the page\'s own button in the live view.'};

/**
 * Register liveOpen(session), liveInput(session, message), liveClose(session), liveSubmit(session) and liveStop(session). page(session) -> the held tab's loopback CDP address
 * or null; submitControl(session) -> the page's own sending button the form judge named while its ready stands, else ''; stop(session) marks that one stopped.
 * Invariants: one view per session; input reaches only the session it names; a file is answered only from the person's CV or the app's own Open dialog;
 * Submit presses only the judge's button, only after a fresh read of the page finds no required field empty (the person's press: never retried).
 */
export function registerLiveViewHandlers({DEMO = false, storage, ipcMain, toWindow, page, submitControl = async () => '', stop = () => false, getWindow = () => null, dialog, log = () => {},
  openCdp = openCdpSession, attach = null, core = null}) {
  // Why (2026-10-28, Gitar on #2339, twice): a close or a newer open can land at ANY await of an open (the page's address, the CDP session, the attach). Each open takes
  // its token BEFORE the first await and re-checks it after each; a stale open detaches what it opened and attaches nothing. Guard: the class test in test/live-view-handlers.test.js.
  const tokens = new Map();  // session -> the token of the open (or close) that is current
  const views = new Map();   // session -> {input, close}
  const stale = (id, mine) => tokens.get(id) !== mine;
  const retire = id => { const view = views.get(id); views.delete(id); view?.close(); };
  const close = id => { tokens.set(id, Symbol('live')); retire(id); };
  const resolveFile = async choice => {
    if (choice === 'cv') { const file = storage.path('cv.pdf'); return fs.existsSync(file) ? file : null; }
    if (choice !== 'pick') return null;
    const picked = await dialog.showOpenDialog(getWindow(), {properties: ['openFile'], filters: [{name: CV_FILES.label, extensions: CV_FILES.extensions}]});
    return picked.canceled ? null : picked.filePaths[0] || null;
  };
  ipcMain.handle('liveOpen', async (_, session) => {
    const id = String(session || '');
    if (DEMO) return {ok: false, error: 'The demo app has no hidden browser.'};
    const mine = Symbol('live');
    tokens.set(id, mine); retire(id);
    const dropped = {ok: false, error: 'The live page was closed before it opened.'};
    const address = await page(id).catch(() => null);
    if (stale(id, mine)) return dropped;
    if (!address) return {ok: false, error: 'This application\'s hidden form is not open.'};
    const cdp = await openCdp(address);
    if (stale(id, mine)) { await cdp.detach().catch(() => {}); return dropped; }
    const frames = openFrameTargets(address, openCdp);   // iframes in their own process, read for the page's facts
    let input = () => {}, ended = () => {};
    const channel = {send: message => toWindow('liveEvent', {session: id, message}), onMessage: fn => { input = fn; }, onClose: fn => { ended = fn; }};
    views.set(id, {input: message => input(message), close: () => { ended(); frames.close(); }});
    try {
      await (attach || (await liveModule()).attachLive)(channel, cdp, {resolveFile, frameTargets: frames.list});
    } catch (error) {
      if (!stale(id, mine)) views.delete(id);
      ended(); frames.close();
      await cdp.detach().catch(() => {});
      log('apply', 'the live page could not be opened', {session: id});
      return {ok: false, error: 'The live page could not be opened. Try again, or use Open in my browser.'};
    }
    if (stale(id, mine)) { ended(); frames.close(); await cdp.detach().catch(() => {}); return dropped; }
    return {ok: true};
  });
  ipcMain.handle('liveInput', (_, session, message) => { views.get(String(session || ''))?.input(message); return true; });
  ipcMain.handle('liveClose', (_, session) => { close(String(session || '')); return true; });
  // Stop while the hidden fill runs: this application only; the controller hands it to the person at its next look (lib/background-apply-controller.js poll).
  ipcMain.handle('liveStop', (_, session) => (DEMO ? {ok: false, error: 'The demo app has no hidden browser.'} : {ok: !!stop(String(session || ''))}));
  ipcMain.handle('liveSubmit', async (_, session) => {
    const id = String(session || '');
    if (DEMO) return {ok: false, error: 'The demo app has no hidden browser.'};
    const control = await submitControl(id).catch(() => '');
    if (!control) return {ok: false, error: 'Jobadabra has not found this form ready to send. Use the page\'s own Submit in the live view.'};
    const address = await page(id).catch(() => null);
    if (!address) return {ok: false, error: 'This application\'s hidden form is not open.'};
    const {pageFacts, pressText} = core || await liveModule();
    const cdp = await openCdp(address), frames = openFrameTargets(address, openCdp);
    try {
      // Why (28 Oct 2026, owner's live view design): the window's count can be a frame old; the page is read again at the press.
      const facts = await pageFacts(cdp, {targets: frames.list});
      if (!facts) return {ok: false, error: 'The page could not be read. Press Submit again in a moment.'};
      if (facts.left.length) return {ok: false, left: facts.left.length, error: `${plural(facts.left.length, 'required field')} left. Fill ${facts.left.length === 1 ? 'it' : 'them'} in the live page first.`};
      const pressed = await pressText(cdp, control);
      log('apply', pressed.ok ? 'the person pressed Submit in the live view: pressed' : 'the person pressed Submit in the live view: not pressed', {session: id, why: pressed.why || ''});
      return pressed.ok ? {ok: true} : {ok: false, error: PRESS_FAILED[pressed.why] || PRESS_FAILED.not_found};
    } finally { await frames.close(); await cdp.detach().catch(() => {}); }
  });
}

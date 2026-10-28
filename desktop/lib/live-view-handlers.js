// The app screen's thin connection to a hidden-browser session's live view (spec 2026-10-27-background-apply-execution, step B): the core is
// hosted/ready-fill/live.mjs attachLive (any channel, any CDP session); here the channel is the window's IPC, so a phone viewer later reuses the
// core with its own channel. Guards: test/ipc.test.js (every call handled), test/live-view-handlers.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from './root.js';
import {openCdpSession} from './cdp-session.js';
import {CV_FILES} from '../renderer/cv-files.js';

const liveCore = async () => (await import(pathToFileURL(path.join(ROOT, 'hosted', 'ready-fill', 'live.mjs')).href)).attachLive;

/**
 * Register liveOpen(session), liveInput(session, message), liveClose(session). page(session) -> the held tab's loopback CDP address or null.
 * Invariants: one view per session; input reaches only the session it names; a file is answered only from the person's CV or the app's own Open dialog.
 */
export function registerLiveViewHandlers({DEMO = false, storage, ipcMain, toWindow, page, getWindow = () => null, dialog, openCdp = openCdpSession, attach = null}) {
  const views = new Map();   // session -> {input, close}
  const close = id => { const view = views.get(id); views.delete(id); view?.close(); };
  const resolveFile = async choice => {
    if (choice === 'cv') { const file = storage.path('cv.pdf'); return fs.existsSync(file) ? file : null; }
    if (choice !== 'pick') return null;
    const picked = await dialog.showOpenDialog(getWindow(), {properties: ['openFile'], filters: [{name: CV_FILES.label, extensions: CV_FILES.extensions}]});
    return picked.canceled ? null : picked.filePaths[0] || null;
  };
  ipcMain.handle('liveOpen', async (_, session) => {
    const id = String(session || '');
    if (DEMO) return {ok: false, error: 'The demo app has no hidden browser.'};
    const address = await page(id).catch(() => null);
    if (!address) return {ok: false, error: 'This application\'s hidden form is not open.'};
    close(id);
    const cdp = await openCdp(address);
    let input = () => {}, ended = () => {};
    const channel = {send: message => toWindow('liveEvent', {session: id, message}), onMessage: fn => { input = fn; }, onClose: fn => { ended = fn; }};
    views.set(id, {input: message => input(message), close: () => ended()});
    await (attach || await liveCore())(channel, cdp, {resolveFile});
    return {ok: true};
  });
  ipcMain.handle('liveInput', (_, session, message) => { views.get(String(session || ''))?.input(message); return true; });
  ipcMain.handle('liveClose', (_, session) => { close(String(session || '')); return true; });
}

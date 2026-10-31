// LinkedIn jobs on every Find jobs, PR 1/3 (spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the IPC the window uses for the switch and the two
// routes the extension calls (the copied session, and "is the switch still on?"). The session is a credential: nothing here logs it or sends it back. Guard: test/linkedin-handlers.test.js.
import * as session from './linkedin-session.js';

/** The extension's two calls. session: {cookies} from the consent page -> saved or refused; pending: only tells the extension whether to give up its LinkedIn permissions. */
export function linkedinRoutes(storage, deps = {}) {
  return {
    session: payload => session.saveSession(storage, payload?.cookies, deps),
    pending: () => ({revoke: !session.state(storage).on}),
  };
}

/** What the window needs: the state, whether the ask is due on this Find jobs press, and whether a session is held (never its value). */
export function linkedinView(storage, deps = {}) {
  const mine = session.state(storage);
  return {...mine, ask: session.shouldAsk(mine), hasSession: !!session.readSession(deps)};
}

/** Register the window's five LinkedIn-jobs channels and the extension's two routes. In demo mode no store, Keychain or Chrome is touched; `openPage` opens the extension's consent page (browser-handlers.js) and answers {opened}. */
export function registerLinkedinHandlers({DEMO, ipcMain, server, storage, openPage, deps = {}}) {
  const routes = linkedinRoutes(storage, deps);
  server.setVisitRoute('/extension/linkedin-session', payload => routes.session(payload));
  server.setVisitRoute('/extension/linkedin-pending', () => routes.pending());
  ipcMain.handle('linkedinJobsState', () => (DEMO ? {on: false, asked: 0, declined: 0, ask: true, hasSession: false} : linkedinView(storage, deps)));
  ipcMain.handle('linkedinJobsAsked', () => { if (!DEMO) session.noteAsked(storage); return {ok: true}; });
  ipcMain.handle('linkedinJobsAnswer', (_, answer) => { if (!DEMO) session.noteAnswer(storage, answer); return {ok: true}; });
  ipcMain.handle('linkedinJobsConnect', () => (DEMO ? {opened: true} : openPage()));   // the extension's own consent page (browser-handlers.js): Chrome asks for a permission only there, on a click; no extension = {opened: null}
  ipcMain.handle('linkedinJobsOff', () => (DEMO ? {ok: true} : session.turnOff(storage, deps)));
}

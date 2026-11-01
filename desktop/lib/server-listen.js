// Opens the app's local server socket for the Chrome extension, says why when it cannot, and tries again once the port is free.
import {log} from './log.js';

/** The port the extension has built in (extension/flow.js APP). */
export const DEFAULT_PORT = 47111;

let state = {ok: null, port: 0, code: ''};   // ok: null until the first try

/** -> {ok, port, code}: whether the socket the extension talks to is open (ok null: not tried yet). */
export const listenState = () => state;

/** -> {port, code} when the extension can't reach this app because the socket is not open, else undefined (the renderer's `formsOpen.linkOff`). A test app that chose not to listen shows no card. */
export const linkOffOf = current => (current?.ok === false && current.code !== 'TEST_WITHOUT_PORT' ? {port: current.port, code: current.code} : undefined);

/** -> the `formsOpen` answer while no extension has reported: unknown, plus `linkOff` when our own socket is the reason. */
export const unheardForms = current => ({known: false, ids: [], ...(linkOffOf(current) ? {linkOff: linkOffOf(current)} : {})});

/**
 * -> the port this app listens on: JOBADABRA_PORT when it names a whole port, else the production one. The port is fixed because the extension has it built in
 * (extension/flow.js); JOBADABRA_PORT moves it for a test app that runs next to the user's own (the e2e suites copy the extension with the same port, e2e/lib/extension.mjs).
 */
export const portFrom = (env = process.env) => (/^\d+$/.test(env.JOBADABRA_PORT || '') && Number(env.JOBADABRA_PORT) > 0 && Number(env.JOBADABRA_PORT) < 65536 ? Number(env.JOBADABRA_PORT) : DEFAULT_PORT);

/**
 * -> whether a test process is about to take the production port (the owner's app, 47111): an e2e app (JOBADABRA_E2E) or a file run by `node --test` (Node sets
 * NODE_TEST_CONTEXT in it), when the port it opens, or the one its env gives, is 47111. Such a process never listens; a person's app has neither variable.
 * Why (30 Oct 2026, owner's demo): "no JOBADABRA_PORT" alone let a test told 47111, or a bad port that falls back to it, take the owner's port.
 * A test that opens a free port must also put it in `env.JOBADABRA_PORT` before lib/server.js is first imported (it reads PORT once): the env's port counts too, so a free port
 * beside an env without one stays off, silently (`onError` is not called).
 */
export const testWithoutOwnPort = (env = process.env, port = portFrom(env)) => (!!env.JOBADABRA_E2E || !!env.NODE_TEST_CONTEXT) && (port === DEFAULT_PORT || portFrom(env) === DEFAULT_PORT);

/**
 * Listen on 127.0.0.1:port. A busy port is logged once, kept in listenState() and tried again every retryMs until it is free.
 * Why (29 Oct 2026, owner: every session said "Chrome not reporting" while Chrome ran): a leaked e2e test app held 47111 for 27 h; the real app's
 * EADDRINUSE went only to the window's run log, so nothing said why and the card claimed Chrome was closed.
 */
export function listen(server, port, {env = process.env, onError = () => {}, say = log, retryMs = 5000} = {}) {
  const set = next => { state = {...next, port}; };
  if (testWithoutOwnPort(env, port)) {
    set({ok: false, code: 'TEST_WITHOUT_PORT'});
    say('extension', `connection off: a test app never takes the production port ${port}`, {port});
    return;
  }
  let retry = null;
  server.on('listening', () => {
    if (state.ok === false) say('extension', `connection back: port ${port} is free again`, {port});
    set({ok: true, code: ''});
  });
  server.on('error', error => {
    if (server.listening) { onError(error); return; }   // an error on an open socket is not a closed connection
    const code = error.code || 'ERROR', changed = state.code !== code;
    // Why (#2508, Gitar): only EADDRINUSE means another program; any other code (EACCES on a reserved port range) is said as itself and is not retried.
    if (changed) { say('extension', error.code === 'EADDRINUSE' ? `connection off: port ${port} is used by another program` : `connection off: port ${port} could not be opened (${code})`, {port, code}); onError(error); }   // once, not at each retry
    set({ok: false, code});
    if (error.code === 'EADDRINUSE' && !retry) {
      retry = setTimeout(() => { retry = null; server.listen(port, '127.0.0.1'); }, retryMs);
      retry.unref?.();
    }
  });
  server.listen(port, '127.0.0.1');
}

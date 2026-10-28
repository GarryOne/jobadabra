// E2E only: stands in for the Electron calls that reach the owner's own computer (a page in their default browser, a Finder window, their clipboard, their login items).
// A test run never opens, writes or registers anything there; each call is recorded instead (globalThis.__jpHost, and host.log in the run's spool when there is one).
// Why (#2362 / 28 Oct 2026, owner): a local interactions run put ch.indeed.com in the owner's Chrome three times. The PATH stand-in for `open` (e2e/lib/extension.mjs)
// covers only the `open` that lib/browser-launch.js runs; shell.openExternal and the rest reach the OS through LaunchServices and never read PATH.
// Guard: test/e2e-host.test.js (the doors below, and every host call in the app is a door or on its reviewed list).
import fs from 'node:fs';
import path from 'node:path';

// [object on `host`, method, what the real one returns when it works]: the doors a test run closes.
export const DOORS = [
  ['shell', 'openExternal', () => Promise.resolve()],
  ['shell', 'openPath', () => Promise.resolve('')],
  ['shell', 'showItemInFolder', () => undefined],
  ['clipboard', 'writeText', () => undefined],
  ['clipboard', 'readImage', () => ({isEmpty: () => true, toPNG: () => Buffer.alloc(0)})],   // the owner's clipboard is never read: an empty image
  ['app', 'setLoginItemSettings', () => undefined],
];

/**
 * Replaces each door on `host` ({shell, clipboard, app}) with a recorder, only when `env.JOB_PILOTTO_E2E` is set: an app a person runs is never touched.
 * @param {{shell?: object, clipboard?: object, app?: object}} host  @param {NodeJS.ProcessEnv} env  @returns {string[]} the doors closed, as "shell.openExternal"
 */
export function standInHost(host, env = process.env) {
  if (!env.JOB_PILOTTO_E2E) return [];
  const log = globalThis.__jpHost = globalThis.__jpHost || [];
  const spool = env.JOB_PILOTTO_E2E_OPEN_DIR;
  const closed = [];
  for (const [owner, method, result] of DOORS) {
    const target = host[owner];
    if (!target || typeof target[method] !== 'function') continue;
    target[method] = (...args) => {
      const entry = {api: `${owner}.${method}`, args: args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))), at: Date.now()};
      log.push(entry);
      if (spool) { try { fs.appendFileSync(path.join(spool, 'host.log'), `${JSON.stringify(entry)}\n`); } catch { /* a missing spool never opens the real door: the call stays recorded in memory */ } }
      return result();
    };
    closed.push(`${owner}.${method}`);
  }
  return closed;
}

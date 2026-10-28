// A Jobadabra-owned headless Chromium with no window; the actual extension owns fill tabs, and the app's live view shows a held page to the person.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn as spawnProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {ROOT} from './root.js';
import {writePrivate} from './private-file.js';
import {findBackgroundBrowser} from './background-browser-download.js';
import {tabOfSession} from './session-tab.js';

// Why (2026-10-28, e2e proof of Background automation): the test forms use real site names (boards.greenhouse.io), so the hidden browser under e2e must be
// pointed at the fixture server or it would reach the real sites. The harness passes a JSON list in JOB_PILOTTO_E2E_BACKGROUND_BROWSER_ARGS; it counts only with
// JOB_PILOTTO_E2E=1 (never set for a person) and only a host map, the test certificate and (e2e only) --no-sandbox pass, so no other flag, proxy or debugging address can come in this way.
// Why (2026-10-28, #2364): `--no-sandbox` also passes under e2e only: Playwright's own Chromium launches without the sandbox, and a CI runner (Ubuntu 24.04) may not allow the sandbox for the app's plain spawn.
const E2E_ARGUMENTS = /^(--host-resolver-rules=.+|--ignore-certificate-errors|--no-sandbox)$/;
function e2eArguments(env) {
  if (env.JOB_PILOTTO_E2E !== '1') return [];
  try { const list = JSON.parse(env.JOB_PILOTTO_E2E_BACKGROUND_BROWSER_ARGS || '[]'); return Array.isArray(list) ? list.filter(arg => typeof arg === 'string' && E2E_ARGUMENTS.test(arg)) : []; } catch { return []; }
}
/** Return launch flags for an owned profile and extension, never a system profile or a visible startup page. `env` is only read for the e2e harness's host map (above). */
export function browserArguments(profile, extension, env = process.env) {
  // Why (2026-10-28, owner + measured B1): the person sees a held page in the app's live view; headless Chromium loads the extension with no window, Dock entry or focus change.
  return [`--user-data-dir=${profile}`, '--headless=new', '--remote-debugging-port=0', '--enable-automation', '--no-startup-window', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...e2eArguments(env)];
}
/** Accept a debugging port only after CDP reports our exact profile argument; stale/recycled ports never authorize access. */
export function verifiedDebugPort(text, args, profile) {
  const port = Number(String(text).split('\n')[0]);
  return Number.isInteger(port) && port > 0 && port < 65536 && Array.isArray(args) && args.includes(`--user-data-dir=${profile}`) ? port : null;
}
/** Execute one CDP command on a loopback-owned target; timeouts and protocol failures reject without logging page contents. */
export function browserCommand(socketUrl, method, params = {}, {WebSocketClass = globalThis.WebSocket, timeout = 5000} = {}) {
  const url = new URL(socketUrl);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return Promise.reject(new Error('Browser debugging address is not loopback.'));
  return new Promise((resolve, reject) => {
    const socket = new WebSocketClass(socketUrl);
    const done = (error, result) => { clearTimeout(timer); socket.close(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => done(new Error('Owned browser did not answer.')), timeout);
    socket.addEventListener('open', () => socket.send(JSON.stringify({id: 1, method, params})));
    socket.addEventListener('error', () => done(new Error('Owned browser connection failed.')));
    socket.addEventListener('message', event => {
      let row; try { row = JSON.parse(String(event.data)); } catch { return; }
      if (row.id !== 1) return;
      done(row.error ? new Error(`Owned browser refused ${method}.`) : null, row.result);
    });
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Own one persistent browser per app profile; reuse only verified processes and keep review/challenge sessions alive when the app exits. */
export function createBackgroundBrowser(storage, {find = findBackgroundBrowser,   // only the runtime the person downloaded into the app folder; never a system browser
   spawn = spawnProcess, fetchImpl = globalThis.fetch, root = ROOT, command = browserCommand} = {}) {
  const folder = storage.path('background-browser'), profile = path.join(folder, 'profile'), extension = path.join(folder, 'extension');
  const portFile = path.join(profile, 'DevToolsActivePort'), ownerFile = path.join(folder, 'owner.json');
  let pending = null, ownChild = null;
  const get = async (port, route) => { const response = await fetchImpl(`http://127.0.0.1:${port}${route}`, {signal: AbortSignal.timeout(2000)}); if (!response.ok) throw new Error('Owned browser is unavailable.'); return response.json(); };
  const connect = async () => {
    const text = fs.readFileSync(portFile, 'utf8'), port = Number(text.split('\n')[0]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('No owned debugging port.');
    const info = await get(port, '/json/version');
    const args = await command(info.webSocketDebuggerUrl, 'Browser.getBrowserCommandLine');
    if (!verifiedDebugPort(text, args.arguments, profile)) throw new Error('This browser belongs to another profile.');
    return {port, socket: info.webSocketDebuggerUrl};
  };
  async function start({port: appPort, token}) {
    if (!Number.isInteger(appPort) || !token) throw new Error('The app server is not ready.');
    pending ||= (async () => {
      fs.mkdirSync(folder, {recursive: true, mode: 0o700});
      let owner; try { owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')).owner; } catch { /* first use */ }
      if (!owner) { owner = randomUUID(); writePrivate(ownerFile, JSON.stringify({owner})); }
      let live = await connect().catch(() => null);
      if (!live) {
        const executable = find(storage.path('background-browser-runtime'));
        if (!executable) throw Object.assign(new Error('Download the optional background browser first.'), {code: 'BACKGROUND_BROWSER_MISSING'});
        const {copyForNight} = await import(pathToFileURL(path.join(root, 'hosted', 'ready-fill', 'extension-copy.mjs')).href);
        fs.rmSync(extension, {recursive: true, force: true});
        copyForNight(appPort, path.join(root, 'extension'), extension, {owned: true});
        fs.mkdirSync(profile, {recursive: true, mode: 0o700});
        fs.rmSync(portFile, {force: true});
        // Why (2026-10-28, #2364): under e2e the browser's own messages go to a file the harness prints when it does not start (a CI failure said only "did not start"); a person's browser keeps none.
        const log = process.env.JOB_PILOTTO_E2E === '1' ? fs.openSync(path.join(folder, 'e2e-browser.log'), 'w') : 'ignore';
        ownChild = spawn(executable, browserArguments(profile, extension), {detached: true, stdio: ['ignore', log, log], windowsHide: true});
        if (log !== 'ignore') fs.closeSync(log);
        let spawnError = null;
        ownChild.on('error', error => { spawnError = error; });
        ownChild.unref();
        const until = Date.now() + 20000;
        while (!live && Date.now() < until) {
          if (spawnError) throw new Error('The background browser could not start.');
          await pause(100);
          live = await connect().catch(() => null);
        }
        if (!live) { ownChild.kill(); throw new Error('The background browser did not start; its own process was stopped.'); }
      }
      // Only after proving profile ownership may the app token enter this browser's extension storage.
      const until = Date.now() + 15000;
      let worker;
      while (!worker && Date.now() < until) {
        worker = (await get(live.port, '/json/list')).find(target => target.type === 'service_worker' && /^chrome-extension:\/\//.test(target.url) && target.url.endsWith('/background-owned.js'));
        if (!worker) await pause(100);
      }
      if (!worker) throw new Error('The owned browser extension did not start.');
      const {setExtensionStorage} = await import(pathToFileURL(path.join(root, 'hosted', 'ready-fill', 'extension-storage.mjs')).href);
      await setExtensionStorage({evaluate: async (fn, value) => {
        const expression = `(${fn.toString()})(${JSON.stringify(value) || 'undefined'})`;
        const result = await command(worker.webSocketDebuggerUrl, 'Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
        if (result.exceptionDetails) throw new Error('The owned extension is not ready.');
        return result.result?.value;
      }}, {workerUrl: `http://127.0.0.1:${appPort}`, token, backgroundOwner: owner});
      return {owner, port: live.port};
    })().finally(() => { pending = null; });
    return pending;
  }
  async function sessionAction(session, action) {
    const live = await connect();
    const worker = (await get(live.port, '/json/list')).find(target => target.type === 'service_worker' && target.url.endsWith('/background-owned.js'));
    if (!worker) return false;
    const expression = `globalThis.__jobPilottoBackgroundSessions?.${action}(${JSON.stringify(session)})`;
    const result = await command(worker.webSocketDebuggerUrl, 'Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    return result.result?.value === true;
  }
  // The held tab of one application session, by the ONE rule that says which tab is a session's (lib/session-tab.js): its loopback CDP address, or null.
  async function pageSocket(session) {
    const live = await connect();
    const pages = (await get(live.port, '/json/list')).filter(target => target.type === 'page');
    return tabOfSession(String(session || ''), pages)?.webSocketDebuggerUrl || null;
  }
  async function close() { const live = await connect(); await command(live.socket, 'Browser.close').catch(() => {}); }
  return {ready: () => !!find(storage.path('background-browser-runtime')), start, pageSocket, reveal: session => sessionAction(session, 'reveal'), closeSession: session => sessionAction(session, 'closeSession'), close};
}

// Starts the app's own extension server offline for a row replay (speed-5x landing 2): its own process (lib/offline-app-child.mjs), a temp folder with the fake
// applicant, a free port (never the person's app's), the e2e env without keys or the twin (offlineEnv), the real Claude Code install (never a terminal's wrapper),
// and the row's model answers (memo: the case's model-memo.json; a miss is refused unless ask: true). -> {port, token, url, dir, logText(), close()}.
// Guard: e2e/test/offline-app.test.mjs.
// Reaches: ./offline-app-child.mjs   (spawned by path; lib/test-reach.mjs follows it, so a PR changing the app's server runs the tests that start it)
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {freePort} from './extension.mjs';
import {offlineEnv} from './offline-guard.mjs';
import {DUMMY_KEY, isCi} from './engine.mjs';

const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'offline-app-child.mjs');
const DESKTOP = path.resolve(path.dirname(CHILD), '..', '..');
const LIVE_PORT = 47111;   // the person's app

// ask: false (the default) answers only from the row's kept answers and refuses a miss (lib/ai/model-memo.js memoOnly): the plan's claude -p carries the signed-in
// account, so it is asked only when the caller says so. A memo file always exists (an empty one refuses every ask): without one the app would ask the model.
// fill: true (a Mac replay that fills the asks the memo lacks, replay-net.mjs --fill-memo): kept answers served as in a replay, a missed ask answered by the plan's claude -p and kept in the memo.
// captureDir: a live run's capture folder (the app writes its page-kind calls and asks there: lib/live-capture.js), as the Electron app does under the harness.
// api: {url, key} (the pool on a CI runner, lib/live-row.mjs): the app asks through its own API engine, to the harness's metering proxy at url (this computer only:
// the app's network stays cut to loopback), with key; a real key on CI only (lib/engine.mjs), the placeholder anywhere else. Without it: the plan's claude -p.
export async function startOfflineApp({memo = '', ask = false, loose = '', missLog = '', captureDir = '', slow = false, ordinal = '', fill = false, api = null, journey = false, review = false, env: parent = process.env, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-offline-app-')), timeoutMs = 20000} = {}) {
  if (api && !/^http:\/\/127\.0\.0\.1:\d+$/.test(String(api.url || ''))) throw new Error(`offline app: the AI proxy must be on this computer (http://127.0.0.1:<port>), not ${api.url}`);
  if (api && !api.key) throw new Error('offline app: the API path needs a key (the placeholder off CI)');
  if (api && api.key !== DUMMY_KEY && !isCi(parent)) throw new Error('offline app: a real API key is for CI only (lib/engine.mjs); a Mac uses the placeholder key against a canned proxy');
  const refill = fill && isCi(parent) && parent.JP_REFILL_CI === '1';   // CI's refill workflow: the fill asks the API through the metering proxy, on its own key (lib/refill.mjs)
  if (fill && (ask || (api && !refill) || (isCi(parent) && !refill) || (refill && !api))) throw new Error('offline app: fill is a memo-only replay on a Mac (the plan\'s claude -p), or on CI only through the refill workflow with its proxy; never with ask or another API key');
  if (!memo) { memo = path.join(dir, 'model-memo.json'); fs.mkdirSync(dir, {recursive: true}); }
  // The app imports the worker from desktop/shared/ (scripts/stage.mjs, run by npm start and npm test): a fresh worktree has none yet.
  if (!fs.existsSync(path.join(DESKTOP, 'shared', 'worker', 'extension.js'))) execFileSync(process.execPath, [path.join(DESKTOP, 'scripts', 'stage.mjs'), '--files-only'], {cwd: DESKTOP, stdio: 'ignore'});
  const port = await freePort();
  if (port === LIVE_PORT) throw new Error('offline app: never the live app\'s port');
  const env = {...offlineEnv(dir, parent), ...(api ? {ANTHROPIC_BASE_URL: api.url, JOB_PILOTTO_E2E_API_KEY: api.key} : {}), JOB_PILOTTO_PORT: String(port), JOB_PILOTTO_MODEL_MEMO: memo, ...(ask ? {} : {JOB_PILOTTO_MODEL_MEMO_ONLY: '1', ...(fill ? {JOB_PILOTTO_MODEL_MEMO_FILL: '1'} : {}), JOB_PILOTTO_MODEL_MEMO_LATENCY: '1', ...(slow ? {JOB_PILOTTO_MODEL_MEMO_LATENCY_SCALE: '1.6', JOB_PILOTTO_MODEL_MEMO_LATENCY_PAD_MS: '300'} : {})}),   // latency: a kept answer comes after the time the live ask took (lib/ai/model-memo.js: the live interleaving, not this machine's speed)
   ...(loose && !ask ? {JOB_PILOTTO_MODEL_MEMO_LOOSE: loose} : {}), ...(ordinal && !ask ? {JOB_PILOTTO_MODEL_MEMO_ORDINAL: ordinal} : {}), ...(missLog && !ask ? {JOB_PILOTTO_MODEL_MEMO_MISSLOG: missLog} : {}),   // loose: the file a loose memo hit is noted in (lib/ai/model-memo.js looseFile)
   
    JOB_PILOTTO_E2E_OPENER: 'offline-app', ...(journey ? {JP_JOURNEY: '1'} : {}), ...(review ? {JP_REVIEW: '1'} : {}), ...(captureDir ? {LIVE_CAPTURE_DIR: captureDir} : {})};   // an Apply hands its address to the harness (lib/browser-launch.js), never a browser of this computer
  const child = spawn(process.execPath, [CHILD], {env, stdio: ['pipe', 'pipe', 'pipe']});
  let out = '', err = '';
  child.stderr.on('data', chunk => { err += chunk; });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`offline app: not ready in ${timeoutMs} ms ${err.slice(-400)}`)); }, timeoutMs);
    child.stdout.on('data', chunk => {
      out += chunk;
      const line = out.split('\n').find(one => one.startsWith('{"ready"'));
      if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`offline app: exited ${code} ${err.slice(-400)}`)); });
  });
  const logFile = path.join(dir, 'logs', 'app.log');
  // The command channel (lib/offline-app-commands.mjs): call(cmd, ...args) -> its result; onOpen(fn): each address an Apply opens.
  const waiting = new Map(), openers = [];
  let next = 0, seen = out.length;
  child.stdout.on('data', () => {
    const lines = out.slice(seen).split('\n'); seen = out.length - lines.at(-1).length;
    for (const line of lines.slice(0, -1)) {
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.event === 'open') for (const fn of openers) fn(message.url);
      else if (waiting.has(message.id)) { const {resolve, reject} = waiting.get(message.id); waiting.delete(message.id); if (message.ok) resolve(message.result); else reject(new Error(message.error)); }
    }
  });
  const call = (cmd, ...args) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, {resolve, reject}); child.stdin.write(`${JSON.stringify({id, cmd, args})}\n`); });
  return {
    ...ready, url: `http://127.0.0.1:${ready.port}`, call, onOpen: fn => openers.push(fn),
    logText: () => { try { return fs.readFileSync(logFile, 'utf8'); } catch { return ''; } },
    stderr: () => err,
    close: () => new Promise(resolve => { if (child.exitCode != null) return resolve(); child.once('exit', () => resolve()); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000).unref(); }),
  };
}

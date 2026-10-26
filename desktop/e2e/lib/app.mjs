/* global document, window */
// Launch the real Jobadabra app (Electron) with a throwaway profile, like a first-time user, and drive it through Playwright.
// Nothing here touches the real user's data: JOB_PILOTTO_USER_DATA points at a fresh temp folder and no .env is read.
import {journey} from './journey.mjs';
import {ownerGuardEnv} from './owner-guard-env.mjs';
import {_electron as electron} from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DESKTOP = path.resolve(E2E, '..');
// Windows has no .bin/electron executable (it is a .cmd that Playwright cannot start): the package itself says where electron.exe is. Elsewhere: unchanged.
import {createRequire} from 'node:module';
import {appLogText} from './app-log.mjs';
import {keepRunLogs} from './run-logs.mjs';
import {pythonCoverage, saveCoverage, startCoverage, takeSetup, takeStep} from './coverage.mjs';   // E2E_COVERAGE=1: what app code this session, and each step, ran (gate G1b)
import {refuseWrapper, withoutWrappers} from './real-claude.mjs';   // never a terminal's claude wrapper (e2e/test/real-claude.test.mjs)
const electronPath = () => {
  if (process.platform !== 'win32') return path.join(DESKTOP, 'node_modules', '.bin', 'electron');
  return createRequire(path.join(DESKTOP, 'package.json'))('electron');
};
export const ARTIFACTS = process.env.E2E_ARTIFACTS || path.join(E2E, 'artifacts', process.env.E2E_SUITE || 'default');

// -> {app, page, profile, shot(name), close()}. `env` adds to the app's environment (models, test hooks).
export const zoneOf = (env = {}) => env.TZ || 'Europe/Zurich';

// Hidden windows (lib/e2e-hidden.js) only on the owner's Mac, so a run doesn't steal focus; CI is unchanged. E2E_HIDDEN=0 to watch, =1 to force.
const hidden = (env = process.env) => (env.E2E_HIDDEN ? (env.E2E_HIDDEN === '1' ? '1' : '0') : (process.platform === 'darwin' && !env.CI ? '1' : '0'));

export async function launch({env = {}, executablePath, args, profile: again, lang = '', settings = {}} = {}) {   // lang: the window's language (Chromium's --lang), for a seeded place; settings: a fresh profile's start (the store, lib/store.mjs)
  refuseWrapper(settings.claudeCode?.path);
  const profile = again || fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-'));   // `again`: the same profile, a second start (a relaunch keeps the person's data)
  fs.mkdirSync(ARTIFACTS, {recursive: true});
  // The test app is a stranger to the product: no technical reports, no employer-pool sharing, nothing it learns leaves this computer.
  if (!again) fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({telemetry: false, shareEmployers: false, ...settings}));
  pythonCoverage();   // E2E_COVERAGE=1: the engine's Python records its lines per step too (lib/coverage.mjs)
  // Linux (CI runners, 6 Oct 2026): no keyring there, so Chromium's basic password store keeps the app's keys (test keys only, a throwaway profile).
  const app = await electron.launch({
    executablePath: executablePath || electronPath(),
    args: args || [DESKTOP, ...(process.platform === 'linux' ? ['--no-sandbox', '--password-store=basic'] : []), ...(lang ? [`--lang=${lang}`] : [])],
    // The app counts days in the computer's own zone; the suites check it against Europe/Zurich (lib/focus-data.mjs). On a CI runner in UTC the two disagreed
    // about "today" from 0:00 to 2:00 Zurich time, and Focus's 14-day count failed only then (4 Oct 2026). A suite that tests another zone sets TZ, and the engine follows it
    // (it reads JOB_PILOTTO_TZ first: the calendar suite's Tokyo and Honolulu must reach both the window and the engine).
    env: withoutWrappers({...process.env, TZ: zoneOf(env), JOB_PILOTTO_TZ: env.JOB_PILOTTO_TZ || zoneOf(env), JOB_PILOTTO_USER_DATA: profile, JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_E2E: '1', ...ownerGuardEnv(), JOB_PILOTTO_E2E_HIDDEN: hidden(), ...env}),
    timeout: 90000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  page.on('pageerror', error => { console.log(`  ! page error: ${error.message}`); journey.pageErrors.push(`${error.name || 'Error'}: ${error.message}`); });
  page.on('console', message => { if (message.type() === 'error') journey.consoleErrors.push(message.text()); });
  // Only the app's own files (the window's scripts, styles, images): an outside address failing is not the app's bug.
  page.on('requestfailed', request => { if (/^file:/.test(request.url()) && !/ERR_ABORTED/.test(request.failure()?.errorText || '')) journey.failedLoads.push(request.url().replace(/^.*\/desktop\//, 'desktop/')); });
  await confirmQuiet(profile);
  const trace = await startTrace(app);
  const coverage = await startCoverage(app, page).catch(() => null);
  const shot = name => page.screenshot({path: path.join(ARTIFACTS, `${name}.png`)}).catch(() => {});
  // Copy the app's own logs next to the screenshots (the test profile holds only fictional data, and the logs never contain keys), and print the engine's last lines.
  const keepLogs = async () => {
    const from = path.join(profile, 'logs');
    try {
      const counts = keepRunLogs(profile, ARTIFACTS);   // lib/run-logs.mjs: notion-requests.log and store-call.log are always there, empty when nothing was asked
      console.log(`  logs kept: ${Object.entries(counts).map(([name, lines]) => `${name} ${lines} line(s)`).join(', ')}`);
      const engine = path.join(from, 'engine.log');
      if (fs.existsSync(engine)) console.log(`  --- the engine's last lines ---\n${fs.readFileSync(engine, 'utf8').split('\n').slice(-40).join('\n')}`);
    } catch { /* logs are a help, never a reason to fail */ }
  };
  // close({keepTrace}): the trace is written only when asked (a step failed); otherwise it is dropped unwritten.
  // coverageMark/coverageStep: the runner's reads at a step's start and end (lib/runner.mjs); a no-op without E2E_COVERAGE=1.
  return {app, page, profile, shot, keepLogs, traceGroup: trace.group, traceGroupEnd: trace.groupEnd,
    coverageMark: name => takeSetup(coverage, name).catch(() => {}), coverageStep: name => takeStep(coverage, name).catch(() => {}),
    close: async ({keepTrace = false} = {}) => { await keepLogs().catch(() => {}); await saveCoverage(coverage, ARTIFACTS).catch(() => {}); await trace.stop(keepTrace); await closeApp(app); }};
}

// A Playwright trace of each app session (6 Oct 2026): every action with its screenshot strip, the page before and after (DOM snapshots), console and network, each step
// a named group (lib/runner.mjs). Opened on https://trace.playwright.dev or with `npx playwright show-trace`. Recorded always, written only for a failed suite
// (trace-<suite>.zip, trace-<suite>-2.zip after a relaunch); E2E_TRACE=0 turns it off. Never a reason to fail: a trace that cannot start or stop is only logged.
let traces = 0;
export const traceFiles = () => (fs.existsSync(ARTIFACTS) ? fs.readdirSync(ARTIFACTS).filter(name => /^trace-.*\.zip$/.test(name)).sort() : []);
async function startTrace(app, env = process.env) {
  const off = {group: async () => {}, groupEnd: async () => {}, stop: async () => {}};
  if (env.E2E_TRACE === '0') return off;
  const tracing = app.context().tracing;
  try { await tracing.start({screenshots: true, snapshots: true, sources: true}); } catch (error) { console.log(`  (no trace: ${error.message})`); return off; }
  const number = ++traces, quiet = promise => promise.catch(() => {});
  const file = path.join(ARTIFACTS, `trace-${env.E2E_SUITE || 'default'}${number > 1 ? `-${number}` : ''}.zip`);
  return {
    group: name => quiet(tracing.group(name)), groupEnd: () => quiet(tracing.groupEnd()),
    // A hung app must not hang the close: 60 s at most (a long suite's trace takes a few seconds to write).
    stop: keep => Promise.race([tracing.stop(keep ? {path: file} : {}).then(() => { if (keep) console.log(`  trace: ${path.basename(file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`); }),
      new Promise((_, fail) => setTimeout(() => fail(new Error('took over 60 s')), 60000).unref())]).catch(error => console.log(`  (trace not written: ${error.message})`)),
  };
}

// Which wizard step is showing.
export const step = page => page.evaluate(() => [...document.querySelectorAll('.step')].find(el => !el.hidden && el.offsetParent !== null)?.dataset.step ?? null);

// Stand in for the native file dialog (Playwright cannot click an OS window): the next showOpenDialog returns this file.
export const pickFile = (app, file) => app.evaluate(({dialog}, filePath) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [filePath]});
}, file);

// The app has its own quit handling (it asks before closing while sessions run), so app.close() can wait forever. Exit it directly,
// and kill the process if even that does not return.
async function closeApp(app) {
  try {
    const child = app.process();
    if (process.platform === 'win32') await keyWritten(app);
    console.log(`  ${new Date().toISOString()} e2e: closing the app (pid ${child.pid})`);   // tells the harness's exit from the app's own in logs/app.log
    await Promise.race([app.evaluate(({app: electron}) => electron.exit(0)).catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  } catch { /* the app is already gone */ }
}

// Windows: the key that seals saved secrets (safeStorage, DPAPI) is kept in Chromium's "Local State", which a fresh profile writes on a timer (~10 s). The hard
// exit above came 5.7 s after a first start, the next start had a new key, and the Notion token saved meanwhile could not be read (7 Oct 2026, jobs suite: "the app
// did not link this workspace's Search settings page"; app.log "[secrets] unreadable on this computer"). The exit stays a crash for the app's own data; only
// Chromium's key file is waited for. A crash that early is the app's to survive (lib/storage.js asks for the key again), not what any step checks.
export async function keyWritten(app, {within = 15000, every = 250} = {}) {
  const dir = await app.evaluate(({app: electron}) => electron.getPath('userData')).catch(() => '');
  if (!dir) return false;   // the app is gone or not answering: the close goes on to exit or kill it
  const file = path.join(dir, 'Local State');
  for (const started = Date.now(); Date.now() - started < within; await new Promise(resolve => setTimeout(resolve, every))) {
    try { if (fs.readFileSync(file, 'utf8').includes('"encrypted_key"')) return true; } catch { /* not written yet */ }
  }
  console.log(`  e2e: Chromium's key file (${file}) still lacks its key after ${within / 1000} s; closing anyway`);
  return false;
}

// Wait until the visible page has stopped loading (no skeleton bars or spinners), up to `seconds`; returns whether it settled. A screenshot taken
// while a page still shows its loading state makes the AI review report skeletons as bugs, and a slow CI machine shows them for longer.
export async function settle(page, seconds = 20) {
  try {
    await page.waitForFunction(() => ![...document.querySelectorAll('.view:not([hidden]) .skeleton, .view:not([hidden]) .spinner')].some(el => el.offsetParent !== null),
      null, {timeout: seconds * 1000});
    await page.waitForTimeout(400);
    return true;
  } catch { return false; }
}

// The journey must never alter the live telemetry (the owner's rule, 2 Oct 2026). The app says in its own log why it is not reporting; no such line, no run.
async function confirmQuiet(profile) {
  for (let waited = 0; waited < 20000; waited += 500) {
    const text = appLogText(profile);
    if (/\[telemetry\] reporting is off: (?:the end-to-end journey|demo mode)/.test(text)) return;   // demo mode never reports either
    if (/\[telemetry\] reporting follows/.test(text)) throw new Error('the app would report to the live product: refusing to run the journey');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('the app did not confirm that reporting is off: refusing to run the journey');
}

// After a run: nothing may be waiting to be sent.
export function assertNothingQueued(profile) {
  for (const name of ['telemetry-queue.json', 'analytics-queue.json']) {
    const file = path.join(profile, name);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').replace(/\s/g, '').length > 2) throw new Error(`${name} has events waiting to be sent`);
  }
}

// What the app itself knows right now, in a few safe words: given to the screenshot review so it can tell a page that contradicts the app's state
// (an engine card says one thing, the panel below another) from one that is simply fine. No values of secrets, only whether they exist.
export const facts = page => page.evaluate(() => {
  const state = window.__jp?.shared?.state || {};
  const settings = state.settings || {};
  const visible = document.querySelector('.view:not([hidden])')?.dataset.view || '';
  return {
    page: visible,
    settingsSection: visible === 'settings' ? (document.querySelector('.settings-nav .is-active')?.dataset.settingsGo || '') : '',
    aiEngineChosen: settings.aiEngine || '(none chosen)',
    anthropicKeySaved: !!state.secrets?.ANTHROPIC_API_KEY,
    claudeCodeInstalled: !!settings.claudeCode?.path,
    notionConnected: !!state.notion,
    setupDone: !!settings.setupDone,
    jobsInList: (window.__jp?.shared?.allJobs || []).length,
    jobsUnscored: (window.__jp?.shared?.allJobs || []).filter(job => job.fit == null || job.fit === '').length,
  };
});

/* global document, window */
// Job: wait on state
// Launch the real Jobadabra app (Electron) with a throwaway profile, like a first-time user, and drive it through Playwright.
// Nothing here touches the real user's data: JOBADABRA_USER_DATA points at a fresh temp folder and no .env is read.
import {endTree, holdersOf, listProcesses, treeOf, waitTreeGone} from './app-tree.mjs';
import {appLaunchEnv} from './app-env.mjs';
import {journey} from './journey.mjs';
import {ownerGuardEnv} from './owner-guard-env.mjs';
import {ownPortEnv} from './own-port.mjs';
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
import {stepTimeLeft} from './wait-on-state.mjs';
import {keepRunLogs} from './run-logs.mjs';
import {appPicture} from './window-shot.mjs';
import {pythonCoverage, saveCoverage, startCoverage, takeSetup, takeStep} from './coverage.mjs';   // E2E_COVERAGE=1: what app code this session, and each step, ran (gate G1b)
import {refuseWrapper, withoutWrappers} from './real-claude.mjs';   // never a terminal's claude wrapper (e2e/test/real-claude.test.mjs)
const electronPath = () => {
  if (process.platform !== 'win32') return path.join(DESKTOP, 'node_modules', '.bin', 'electron');
  return createRequire(path.join(DESKTOP, 'package.json'))('electron');
};
export const ARTIFACTS = process.env.E2E_ARTIFACTS || path.join(E2E, 'artifacts', process.env.E2E_SUITE || 'default');

// -> {app, page, profile, shot(name), close()}. `env` adds to the app's environment (models, test hooks).
export const zoneOf = (env = {}) => env.TZ || 'Europe/Zurich';

/** Build a fresh isolated profile, preserving a suite's explicit setting overrides. */
export const initialSettings = (settings = {}) => ({telemetry: false, shareEmployers: false, shareEmployersChosen: true, apply: {mode: 'check', chosenAt: '2026-10-26T00:00:00.000Z'},
  // Why (31 Oct 2026, LinkedIn jobs 1/3): the ask on the first two Find jobs presses is a dialog that would sit over every suite's press; a test app has answered it twice.
  linkedinJobs: {asked: 2, declined: 2}, ...settings});

// Hidden windows (lib/e2e-hidden.js) only on the owner's Mac, so a run doesn't steal focus; CI is unchanged. E2E_HIDDEN=0 to watch, =1 to force.
const hidden = (env = process.env) => (env.E2E_HIDDEN ? (env.E2E_HIDDEN === '1' ? '1' : '0') : (process.platform === 'darwin' && !env.CI ? '1' : '0'));

export async function launch({env = {}, executablePath, args, profile: again, lang = '', settings = {}} = {}) {   // lang: the window's language (Chromium's --lang), for a seeded place; settings: a fresh profile's start (the store, lib/store.mjs)
  refuseWrapper(settings.claudeCode?.path);
  const profile = again || fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-'));   // `again`: the same profile, a second start (a relaunch keeps the person's data)
  fs.mkdirSync(ARTIFACTS, {recursive: true});
  // The test app is a stranger to the product: no technical reports, no employer-pool sharing, nothing it learns leaves this computer.
  // It chose Standard automation already (the first-Apply dialog, lib/apply-choice-gate.js): an Apply step goes on as before; a suite that tests the dialog passes settings.apply.
  if (!again) fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(initialSettings(settings)));
  pythonCoverage();   // E2E_COVERAGE=1: the engine's Python records its lines per step too (lib/coverage.mjs)
  // Linux (CI runners, 6 Oct 2026): no keyring there, so Chromium's basic password store keeps the app's keys (test keys only, a throwaway profile).
  const port = await ownPortEnv(env);   // Why (29 Oct 2026, owner): a test app without its own port took 47111 and, left running, kept the owner's app from ever hearing Chrome
  const app = await electron.launch({
    executablePath: executablePath || electronPath(),
    args: args || [DESKTOP, ...(process.platform === 'linux' ? ['--no-sandbox', '--password-store=basic'] : []), ...(lang ? [`--lang=${lang}`] : [])],
    // The app counts days in the computer's own zone; the suites check it against Europe/Zurich (lib/focus-data.mjs). On a CI runner in UTC the two disagreed
    // about "today" from 0:00 to 2:00 Zurich time, and Focus's 14-day count failed only then (4 Oct 2026). A suite that tests another zone sets TZ, and the engine follows it
    // (it reads JOBADABRA_TZ first: the calendar suite's Tokyo and Honolulu must reach both the window and the engine).
    env: withoutWrappers(appLaunchEnv(process.env, { TZ: zoneOf(env), JOBADABRA_TZ: env.JOBADABRA_TZ || zoneOf(env), JOBADABRA_USER_DATA: profile, JOBADABRA_NO_DOTENV: '1', JOBADABRA_E2E: '1', JOBADABRA_E2E_RUNNER_PID: String(process.pid), ...ownerGuardEnv(), JOBADABRA_E2E_HIDDEN: hidden(), ...port, ...env})),   // the app watches this runner and ends when it is gone, even if it was killed (lib/e2e-host.js watchRunner)
    timeout: 90000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Why (28 Oct 2026, owner): a test run must never reach the owner's browser, Finder, clipboard or login items. The app closes those doors itself under JOBADABRA_E2E
  // (desktop/lib/e2e-host.js; Electron's own shell.openExternal and openPath print "[native code]", the stand-ins do not); a run that finds them open stops here, before any step. A packaged build named by executablePath may be older than that code: not checked.
  if (!executablePath && !(await app.evaluate(({shell}) => Array.isArray(globalThis.__jpHost) && ![shell.openExternal, shell.openPath].some(call => /\[native code\]/.test(Function.prototype.toString.call(call)))).catch(() => false))) { await closeApp(app); throw new Error("a test run must not reach the owner's browser, Finder or clipboard: the app's host stand-in (lib/e2e-host.js) is not active"); }
  page.on('pageerror', error => { console.log(`  ! page error: ${error.message}`); journey.pageErrors.push(`${error.name || 'Error'}: ${error.message}`); });
  page.on('console', message => { if (message.type() === 'error') journey.consoleErrors.push(message.text()); });
  // Only the app's own files (the window's scripts, styles, images): an outside address failing is not the app's bug.
  page.on('requestfailed', request => { if (/^file:/.test(request.url()) && !/ERR_ABORTED/.test(request.failure()?.errorText || '')) journey.failedLoads.push(request.url().replace(/^.*\/desktop\//, 'desktop/')); });
  await confirmQuiet(profile);
  const trace = await startTrace(app);
  const coverage = await startCoverage(app, page).catch(() => null);
  // A shot is evidence, never a reason to fail a step: one that cannot be taken says so in the log (lib/window-shot.mjs: the window as painted, motion stilled).
  const shot = name => appPicture(app, page).then(png => { fs.mkdirSync(ARTIFACTS, {recursive: true}); fs.writeFileSync(path.join(ARTIFACTS, `${name}.png`), png); })
    .catch(error => console.log(`  (no shot ${name}: ${error.message})`));
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
    close: async ({keepTrace = false, how = 'crash'} = {}) => { await keepLogs().catch(() => {}); await saveCoverage(coverage, ARTIFACTS).catch(() => {}); await trace.stop(keepTrace); await closeApp(app, {how}); }};
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
    stop: async keep => {
      let timer, expired = false;
      try {
        const staging = keep ? fs.mkdtempSync(path.join(path.dirname(ARTIFACTS), '.jp-e2e-trace-')) : null;
        const pending = staging && path.join(staging, path.basename(file));
        // Invariant: upload paths contain only finished traces; a timed-out stop can never publish later.
        const writing = tracing.stop(keep ? {path: pending} : {}).then(() => {
          if (keep && !expired) {
            fs.renameSync(pending, file);
            console.log(`  trace: ${path.basename(file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
          }
        }).finally(() => { if (staging) fs.rmSync(staging, {recursive: true, force: true}); });
        await Promise.race([writing, new Promise((_, fail) => {
          timer = setTimeout(() => { expired = true; fail(new Error('took over 60 s')); }, 60000).unref();
        })]);
      } catch (error) { console.log(`  (trace not written: ${error.message})`); }
      finally { clearTimeout(timer); }
    },
  };
}

// Which wizard step is showing.
export const step = page => page.evaluate(() => [...document.querySelectorAll('.step')].find(el => !el.hidden && el.offsetParent !== null)?.dataset.step ?? null);

// Stand in for the native file dialog (Playwright cannot click an OS window): the next showOpenDialog returns this file.
export const pickFile = (app, file) => app.evaluate(({dialog}, filePath) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [filePath]});
}, file);

// Why (1 Nov 2026, #2755, Gitar): how long a closing app gets to leave by itself before what is left is ended. It is the bound the exit request has always had here (since 2 Oct 2026) and
// it judges nothing: no verdict says "too slow", a straggler is ended sooner, the outcome (the tree is gone) is the same. A step's clock (stepTimeLeft) would let a straggler run for minutes.
const EXIT_GUARD_MS = 5000;
/**
 * Closes the app the hard way (how 'crash'; 'quit' is quitApp below). The app has its own quit handling (it asks before closing while sessions run), so app.close() can wait forever:
 * exit it directly, then give everything the launch started `graceMs` to leave and end what stays. Takes the Playwright app; resolves when the whole tree is gone.
 * Why (1 Nov 2026, #2717; beta 41220959824): on Windows Playwright starts Electron through a shell (shell: true), so app.process() is that shell and the app is its child. Killing only
 * `child` while the app was still tearing down left the app running with its parent gone (pid 8092), holding the profile the next start of it uses; 20 s later the reset's folder wait failed.
 * The tree is taken before the exit (a child's parent is lost once the parent dies). Guard: test/close-app-tree.test.mjs.
 */
export async function closeApp(app, {how = 'crash', graceMs = EXIT_GUARD_MS, exitCapMs, list = listProcesses} = {}) {
  if (how === 'quit') return quitApp(app, exitCapMs === undefined ? {} : {exitCapMs});
  let child;
  // Why (1 Nov 2026, #2755 Linux settings red): an app that ended by itself (a reset, an import) cannot say its process any more: Playwright throws a TypeError. Nothing is left to end then.
  try { child = app.process(); } catch { return; }
  if (process.platform === 'win32') await keyWritten(app);
  const rows = list();
  const tree = treeOf(rows, child.pid);   // the launcher as listed (pid + start) and what it started; never the harness or anything above it
  // A lister that failed (the Windows query has a 15 s limit) answers nothing, which looks like "nothing below": say it, or a red looks like this fix does not work.
  console.log(`  ${new Date().toISOString()} e2e: closing the app (pid ${child.pid}, ${Math.max(0, tree.length - 1)} process(es) below it${!rows.length ? '; the process list came back empty, so the app\'s tree is not known' : rows.some(row => row.started) ? '' : '; the process list has no start times, so stale parent ids cannot be told from real ones'})`);   // tells the harness's exit from the app's own in logs/app.log
  try { await Promise.race([app.evaluate(({app: electron}) => electron.exit(0)).catch(() => {}), new Promise(resolve => setTimeout(resolve, EXIT_GUARD_MS))]); } catch { /* the app is already gone */ }
  // Why (1 Nov 2026, review of #2717): closeApp runs inside the teardown chain (ctx.close), where a throw would skip closing the test servers and writing the artifacts, and in launch()'s
  // refusal path, where it would replace the refusal. A process that survives its kill is said here, loudly; the next start's folder wait names it again.
  try {
    const ended = await endTree(tree, {graceMs, list});
    if (ended.length) console.log(`  e2e: ${ended.length} process(es) of the closed app were still running ${graceMs / 1000} s later and were ended: ${holdersOf(ended)}`);
  } catch (error) { console.log(`  e2e: ${error.message}`); }
}

/**
 * The person's quit (how: 'quit'): the quit question, if the app asks one, is answered "Quit now"; the app's own will-quit then ends its engine children and waits for their exit
 * (lib/lifecycle.js). Waits for the app's exit EVENT, then until every process it had started is gone, and fails naming the ones that are not (their pid and command line).
 * Why (31 Oct 2026, owner: quitting must end every engine child): electron.exit(0) skips the quit a person does, so an engine child stayed behind holding a hung AI call
 * (activityfailures CI 41217478444) and, on Windows, the data folder (settings, beta 41220959824). A crash step keeps how: 'crash'. Guard: test/app-tree.test.mjs.
 */
async function quitApp(app, {exitCapMs = stepTimeLeft() ?? 30000} = {}) {
  const child = app.process();
  const exited = child.exitCode !== null || child.signalCode ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') await keyWritten(app);
  const whole = treeOf(listProcesses(), child.pid), tree = whole.slice(1);   // taken last before the quit (after the Windows key wait): what the app has started
  console.log(`  ${new Date().toISOString()} e2e: quitting the app (pid ${child.pid}, ${tree.length} process(es) below it)`);
  await app.evaluate(({app: electron, dialog}) => { dialog.showMessageBoxSync = () => 1; electron.quit(); }).catch(() => {});   // the process may end before evaluate answers
  let timer;
  const verdict = await Promise.race([exited.then(() => 'exited'), new Promise(resolve => { timer = setTimeout(() => resolve('late'), exitCapMs); })]);
  clearTimeout(timer);
  if (verdict === 'late') {   // Why (1 Nov 2026, #2717): killing only the launcher left the app below it (Windows shell) running; the whole tree goes, then the verdict is said.
    let stuck = '';
    try { await endTree(whole, {graceMs: 0}); } catch (error) { stuck = `; ${error.message}`; }
    throw new Error(`the app did not quit by itself within ${exitCapMs / 1000} s after the quit (killed)${stuck}`);
  }
  const left = await waitTreeGone(tree);
  for (const row of left) { try { process.kill(row.pid, 'SIGKILL'); } catch { /* gone meanwhile */ } }   // never leave them behind, whatever the verdict
  if (left.length) throw new Error(`the app quit but ${left.length} process(es) it started are still running: ${holdersOf(left)}`);
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
  } catch {
    const indicator = await page.evaluate(() => {
      const node = [...document.querySelectorAll('.view:not([hidden]) .skeleton, .view:not([hidden]) .spinner')].find(el => el.offsetParent !== null);
      return node ? {id: node.id || node.parentElement?.id || '', classes: node.className} : null;
    }).catch(() => undefined);
    const detail = indicator === undefined ? 'unavailable (page changed or closed)' : indicator === null ? 'none visible now'
      : `${indicator.id ? `#${indicator.id} ` : ''}${indicator.classes}`;
    console.log(`  settle: gave up after ${seconds}s; first visible loader: ${detail}`);
    return false;
  }
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

/* global document, performance */
// Layer 2 of the test pyramid: the app's real window on fictional data, no browser, no Notion, no AI. One hidden Electron launch runs a probe script in the window.
// Why (1 Nov 2026, owner: "I'd like the beta to have only the critical e2e/user journeys. All the others, to run separately less frequently"): screen checks left the e2e
// suites for desktop/integration/app, which CI · Tests · desktop runs on every PR under xvfb (needs-electron.js). The pattern is the one palette-one-row-per-card.test.js uses
// (scripts/shot.mjs): the demo app, `JOB_PILOTTO_SMOKE_EVAL` returns the page's facts as JSON; here with the demo folder replaced by a test's own files.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {appLogLines} from '../../e2e/lib/app-log.mjs';
import {LIMITS, inspect} from '../../e2e/lib/uicheck.mjs';

const desktop = fileURLToPath(new URL('../..', import.meta.url));

/**
 * What a probe script receives in the window (serialised with it; no closure over the test file).
 * until(read, what, hangMs): polls `read()` until it is truthy and returns it; the limit is a hang guard that names the last state seen, never a pause.
 * go(view): opens a page through its menu button and waits for it to be shown. text(selector): the visible text of the first match, '' when absent.
 * severe(view): the layout problems that fail a step (e2e/lib/uicheck.mjs inspect, the check every e2e snapshot ran): [] when the page is sound.
 */
const prelude = (inspectPage, limits) => {
  const until = async (read, what, hangMs = 30000) => {
    const hang = performance.now() + hangMs;
    for (let last; ;) {
      try { last = await read(); if (last) return last; } catch (error) { last = `threw ${error.message}`; }
      // Why (1 Nov 2026): a poll interval for a state that is not here yet, bounded by the hang guard (the page's own work is what moves the state), not a wait for time to pass.
      if (performance.now() > hang) throw new Error(`hung waiting for ${what}; last state: ${typeof last === 'string' ? last : JSON.stringify(last)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const go = async view => {
    document.querySelector(`.nav[data-view="${view}"]:not([data-settings])`).click();
    await until(() => document.querySelector(`.view[data-view="${view}"]:not([hidden])`), `the ${view} page to show`);
  };
  const text = selector => document.querySelector(selector)?.innerText || '';
  const severe = view => inspectPage({view, limits}).filter(item => item.severity === 'severe').map(item => `${item.kind}: ${item.detail}`);
  return {until, go, text, severe};
};

/**
 * Runs `script` in the demo app's window and returns what it returns (JSON). The demo folder is copied to a temp folder first; `files` replaces files in it
 * (an object is written as JSON, a string as is), `settings` is merged into settings.json, `env` is added to the app's environment.
 * `after(helpers, before)`: runs after the window is reloaded (⌘R), with what `script` returned; its value is the result (`script`'s alone when there is none).
 * `use`: factories of page-specific helpers, `base => ({...})`, merged into the helpers the script receives.
 * `picture`: a name (lower case letters, digits, dashes). With E2E_SHOTS_DIR set (the night's run sets it, a PR's run does not) the app also takes its end-of-run picture and, once the script has
 * returned without an error, it is copied to `<E2E_SHOTS_DIR>/ui-<picture>.png`, the name the e2e shots have, so the night's AI screenshot review reads it with no new reader. Without the variable nothing
 * is taken. A picture that cannot be copied is a warning, never a failure.
 * Why (1 Nov 2026, owner: "Also add integration shots"): ONE picture per launch, at the end. A capture in the middle of a script (webContents.capturePage from the main process while the page awaits it)
 * was tried twice and dropped: on a hidden window it hands back the PREVIOUS frame on every other call (the activity states credits/telegram and google/unexplained came out byte-identical, one came out as
 * Focus); waiting two animation frames and invalidate() before the capture did not change that. The end-of-run capture is the one path that is right (scripts/shot.mjs uses it), so do not retry the other.
 * @param {{script: (helpers: ReturnType<typeof prelude>) => Promise<unknown>, files?: Record<string, unknown>, settings?: object, env?: Record<string, string>, timeout?: number, picture?: string}} options
 * @returns {{result: unknown, host: {api: string, args: string[]}[], log: string[]}} the script's value, the app.log lines of the run, and every call the app made to the computer (shell.openExternal, clipboard, ...: lib/e2e-host.js doors, recorded, never run)
 * @throws when the script threw in the window (its message and the last state it saw), or the app did not answer
 */
export function probeWindow({script, after = null, use = [], files = {}, settings = {}, env = {}, timeout = 120000, picture = ''}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-probe-'));
  try {
    for (const file of fs.readdirSync(path.join(desktop, 'demo'))) fs.copyFileSync(path.join(desktop, 'demo', file), path.join(folder, file));
    const settingsFile = path.join(folder, 'settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), ...settings}, null, 1));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), typeof content === 'string' ? content : JSON.stringify(content, null, 1));
    const out = path.join(folder, 'probe.png');
    const keep = Boolean(picture && process.env.E2E_SHOTS_DIR && !after);   // a picture is taken only for a plain script (an `after` run reloads first)
    // `use`: page-specific helper factories, each `base => ({...helpers})`, serialised with the script (no closure over the test file).
    const helpers = `(() => { const base = (${prelude.toString()})(${inspect.toString()}, ${JSON.stringify(LIMITS)}); return Object.assign(base, ${use.map(factory => `(${factory.toString()})(base)`).join(', ') || '{}'}); })()`;
    // With `after`: `script` runs first and parks its value in sessionStorage (it survives the reload), the app reloads, `after` runs and returns.
    // Why (1 Nov 2026, try 1 on a stale picture): the app's end-of-run capture follows SMOKE_EVAL at once, so it caught the frame painted BEFORE the script changed the page (Telegram's run came out as Focus, the
    // filtered library as the full one). SMOKE_JS is followed by the app's own settle (main-window.js, 400 ms) and then the capture, which is the order scripts/shot.mjs relies on. So a picture run goes the
    // two-phase way: the script runs as SMOKE_JS and parks its value in sessionStorage, SMOKE_EVAL only reads it back (no reload).
    const park = `(async () => { try { sessionStorage.setItem('__probeBefore', JSON.stringify(await (${script.toString()})(${helpers}) ?? null)); } catch (error) { sessionStorage.setItem('__probeBefore', JSON.stringify({__error: String(error.message)})); } })()`;
    const readBack = `(() => { const before = JSON.parse(sessionStorage.getItem('__probeBefore')); if (before?.__error) throw new Error(before.__error); return before; })()`;
    const code = after ? `(() => { const before = JSON.parse(sessionStorage.getItem('__probeBefore')); if (before?.__error) throw new Error(before.__error); return (${after.toString()})(${helpers}, before); })()` : keep ? readBack : `(${script.toString()})(${helpers})`;
    const first = after || keep ? park : '';
    const run = spawnSync(path.join(desktop, 'node_modules', '.bin', 'electron'), ['.'], {cwd: desktop, encoding: 'utf8', timeout, env: {
      ...process.env, JOB_PILOTTO_DEMO: '1', JOB_PILOTTO_DEMO_DIR: folder, JOB_PILOTTO_USER_DATA: folder, JOB_PILOTTO_SMOKE: out, ...(keep ? {} : {JOB_PILOTTO_SMOKE_NO_PICTURE: '1'}), JOB_PILOTTO_E2E_OPEN_DIR: folder,
      JOB_PILOTTO_SMOKE_EVAL: code, ...(after ? {JOB_PILOTTO_SMOKE_JS: first, JOB_PILOTTO_SMOKE_RELOAD_JS: '0'} : keep ? {JOB_PILOTTO_SMOKE_JS: first} : {}), JOB_PILOTTO_E2E_RUNNER_PID: String(process.pid), ...env}});
    const answer = `${out}.json`;
    if (!fs.existsSync(answer)) throw new Error(`the app wrote no answer (exit ${run.status}, signal ${run.signal}): ${(run.stderr || run.stdout || '').slice(-600)}`);
    const value = JSON.parse(fs.readFileSync(answer, 'utf8'));
    if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.error === 'string') throw new Error(value.error);
    if (keep) keepPicture(out, process.env.E2E_SHOTS_DIR, picture);
    const hostFile = path.join(folder, 'host.log');
    const host = fs.existsSync(hostFile) ? fs.readFileSync(hostFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    return {result: value, host, log: appLogLines(folder)};
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
}

/** Copies the app's end-of-run picture to <dir>/ui-<name>.png; a failure is a warning, the test goes on. */
function keepPicture(from, dir, name) {
  try {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`the picture name "${name}" is not lower case letters, digits and dashes`);
    fs.mkdirSync(dir, {recursive: true});
    fs.copyFileSync(from, path.join(dir, `ui-${name}.png`));
  } catch (error) { console.warn(`window-probe: the picture ${name} was not kept: ${error.message}`); }
}

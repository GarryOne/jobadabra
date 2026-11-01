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
 * @param {{script: (helpers: ReturnType<typeof prelude>) => Promise<unknown>, files?: Record<string, unknown>, settings?: object, env?: Record<string, string>, timeout?: number}} options
 * @returns {{result: unknown, host: {api: string, args: string[]}[], log: string[]}} the script's value, the app.log lines of the run, and every call the app made to the computer (shell.openExternal, clipboard, ...: lib/e2e-host.js doors, recorded, never run)
 * @throws when the script threw in the window (its message and the last state it saw), or the app did not answer
 */
export function probeWindow({script, after = null, use = [], files = {}, settings = {}, env = {}, timeout = 120000}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-probe-'));
  try {
    for (const file of fs.readdirSync(path.join(desktop, 'demo'))) fs.copyFileSync(path.join(desktop, 'demo', file), path.join(folder, file));
    const settingsFile = path.join(folder, 'settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), ...settings}, null, 1));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), typeof content === 'string' ? content : JSON.stringify(content, null, 1));
    const out = path.join(folder, 'probe.png');
    // `use`: page-specific helper factories, each `base => ({...helpers})`, serialised with the script (no closure over the test file).
    const helpers = `(() => { const base = (${prelude.toString()})(${inspect.toString()}, ${JSON.stringify(LIMITS)}); return Object.assign(base, ${use.map(factory => `(${factory.toString()})(base)`).join(', ') || '{}'}); })()`;
    // With `after`: `script` runs first and parks its value in sessionStorage (it survives the reload), the app reloads, `after` runs and returns.
    const code = after ? `(() => { const before = JSON.parse(sessionStorage.getItem('__probeBefore')); if (before?.__error) throw new Error(before.__error); return (${after.toString()})(${helpers}, before); })()` : `(${script.toString()})(${helpers})`;
    const first = after ? `(async () => { try { sessionStorage.setItem('__probeBefore', JSON.stringify(await (${script.toString()})(${helpers}) ?? null)); } catch (error) { sessionStorage.setItem('__probeBefore', JSON.stringify({__error: String(error.message)})); } })()` : '';
    const run = spawnSync(path.join(desktop, 'node_modules', '.bin', 'electron'), ['.'], {cwd: desktop, encoding: 'utf8', timeout, env: {
      ...process.env, JOB_PILOTTO_DEMO: '1', JOB_PILOTTO_DEMO_DIR: folder, JOB_PILOTTO_USER_DATA: folder, JOB_PILOTTO_SMOKE: out, JOB_PILOTTO_SMOKE_NO_PICTURE: '1', JOB_PILOTTO_E2E_OPEN_DIR: folder,
      JOB_PILOTTO_SMOKE_EVAL: code, ...(after ? {JOB_PILOTTO_SMOKE_JS: first, JOB_PILOTTO_SMOKE_RELOAD_JS: '0'} : {}), JOB_PILOTTO_E2E_RUNNER_PID: String(process.pid), ...env}});
    const answer = `${out}.json`;
    if (!fs.existsSync(answer)) throw new Error(`the app wrote no answer (exit ${run.status}, signal ${run.signal}): ${(run.stderr || run.stdout || '').slice(-600)}`);
    const value = JSON.parse(fs.readFileSync(answer, 'utf8'));
    if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.error === 'string') throw new Error(value.error);
    const hostFile = path.join(folder, 'host.log');
    const host = fs.existsSync(hostFile) ? fs.readFileSync(hostFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    return {result: value, host, log: appLogLines(folder)};
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
}

// Reference screenshots of every screen, for the ui-look-and-feel skill (.claude/skills/ui-look-and-feel):
// what the app looks like today, so a new page or section is built to match. Fictional demo data only (demo/),
// never a real profile. Run after a screen changes: npm run ui-shots  →  docs/ui/<screen>.jpg
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(desktop, 'docs', 'ui');
const electron = path.join(desktop, 'node_modules', '.bin', 'electron');
const wait = ms => `new Promise(r => setTimeout(r, ${ms}))`;
const open = view => `document.querySelector('.nav[data-view=${view}]:not([data-settings])').click();`;   // settings: the menu's Settings, not its Profile
// Ready, not a guess: until an element says the screen has its data (at most 20 s). The last expression is a promise, which
// executeJavaScript waits for (a bare await is not allowed there). 6 Oct 2026: Strategy outgrew a fixed 2.5 s and was shot loading.
const ready = (id, pattern) => `(async () => { for (let i = 0; i < 80 && !${pattern}.test(document.getElementById('${id}')?.textContent || ''); i++) await ${wait(250)}; await ${wait(300)}; })()`;

// name, what it shows (for the skill's table), the script to reach it, extra environment.
export const SCREENS = [
  ['focus', 'Focus: Up next rows, Insight, funnel; side column (progress, reminders, your focus); sessions dock', `${open('focus')} ${wait(900)}`],
  ['focus-loading', 'Loading state: skeleton cards in the page\'s shape, "Syncing…" by Refresh', `${open('focus')} ${wait(900)}`,
    {JOBADABRA_DEMO_FOCUS_DELAY: '60000'}],
  ['jobs', 'Jobs: stat tiles, toolbar, job rows (fit ring, tags, status pill, main action, ⋯)', `${open('jobs')} ${wait(1200)}`],
  ['session', 'Session page: list, job header, compact next-step banner (title · state, one line, actions, Claude\'s message on demand), What Claude needs from you (❓ suggested answer + save tick, ⚖️, 👀), What happened (problems first, form audit), folded session log',
    `document.getElementById('sd-all').click(); ${wait(1500)}`],
  ['actions', 'Actions: running banner, task cards by category with Run, Recent runs table', `${open('actions')} ${wait(1500)}`],
  ['interviews', 'Interviews: recorder, drafts and the saved library table', `${open('interviews')} ${wait(1200)}`],
  ['employers', 'Employers & Sources: toolbar with filters, library table (name + places, kind, feed status, quality, origin, checked, Active switch)', `${open('employers')} ${wait(1200)}`],
  ['settings', 'Settings: setting rows (title, explanation, control)', `${open('settings')} ${wait(1200)}`],
  ['strategy', 'Strategy: targeting rows with chips, score bars, Avoid; side glance card', `${open('strategy')} ${ready('strategy-synced', /^Synced/)}`],
  ['strategy-loading', 'Strategy loading: each card in its final shape, greyed; "Loading strategy…" pill', `${open('strategy')} ${wait(900)}`,
    {JOBADABRA_DEMO_STRATEGY_DELAY: '60000'}],
];

// npm run ui-shots [-- name …]: every screen, or only the named ones; several at once (each its own demo folder).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(out, {recursive: true});
  const wanted = process.argv.slice(2);
  const screens = wanted.length ? SCREENS.filter(([name]) => wanted.includes(name)) : SCREENS;
  const unknown = wanted.filter(name => !SCREENS.some(([known]) => known === name));
  if (unknown.length) { console.error(`unknown screen: ${unknown.join(', ')} (known: ${SCREENS.map(([name]) => name).join(', ')})`); process.exit(1); }
  const shoot = ([name, , js, env = {}]) => new Promise(resolve => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ui-'));
    for (const file of fs.readdirSync(path.join(desktop, 'demo'))) {
      if (file !== 'jobs.json') fs.copyFileSync(path.join(desktop, 'demo', file), path.join(data, file));
    }
    const png = path.join(data, 'shot.png');
    // Why (30 Oct 2026): child.kill() below reaches only the `.bin/electron` shim; the app ends when this script does (lib/e2e-host.js watchRunner).
    const child = spawn(electron, ['.'], {cwd: desktop, stdio: 'ignore', env: {...process.env, ...env,
      JOBADABRA_DEMO: '1', JOBADABRA_E2E_RUNNER_PID: String(process.pid), JOBADABRA_USER_DATA: data, JOBADABRA_SMOKE: png, JOBADABRA_SMOKE_JS: js}});
    const timer = setTimeout(() => child.kill(), 90000);
    child.on('exit', () => {
      clearTimeout(timer);
      if (!fs.existsSync(png)) { console.error(`${name}: no screenshot (its script failed?)`); process.exitCode = 1; }
      // 1400 px wide JPEGs: sharp enough to read, small enough for git (~150 KB each).
      else { execFileSync('sips', ['-Z', '1400', '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', png, '--out', path.join(out, `${name}.jpg`)], {stdio: 'ignore'}); console.log(`docs/ui/${name}.jpg`); }
      fs.rmSync(data, {recursive: true, force: true});
      resolve();
    });
  });
  const started = Date.now();
  const queue = [...screens];
  const workers = Array.from({length: Math.min(4, queue.length)}, async () => { while (queue.length) await shoot(queue.shift()); });
  await Promise.all(workers);
  console.log(`${screens.length} screen(s) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

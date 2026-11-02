// One screen, fast (~5 s), to check a change: npm run shot -- <page> [options]. Fictional demo data only (demo/).
//   pages: focus, jobs, session, actions, strategy, interviews, settings (its Overview), profile
//   --select <css>     only that element (and a small margin), e.g. '#ss-decision'
//   --session <text>   on the session page, open the session whose card contains this text (e.g. Acme)
//   --mark <css>       draw a red frame around every element it matches ("where to look"); repeat the option for several. Use the SAME --mark on the before and the after shot.
//                      A PR shot is the changed card (--select) with the change marked (--mark); a full window is only for a layout change (docs/rules/desktop-ui.md).
//   --full             the whole scrolled page (the window grows to the page's height), not only the viewport
//   --log              expand the session log
//   --reload           reload the window (⌘R) afterwards, and expand the log again if --log
//   --js <code>        more steps to run first (a statement; await allowed)
//   --eval <expr>      write this expression's value as JSON (window.__jp has the state; __jp.terminal() the log)
//                      Without --eval, it prints every saved value cut by its text box (scripts/cut-fields.mjs).
//   --no-picture       only the --eval result, no screenshot
//   --output <file>    a recorded terminal output to show as the session's log (e.g. a real session's)
//   --width <px>       the window's width, to check a narrow layout (default 1280; the window's minimum is lib/main-window.js MIN_WIDTH)
//   --out <file.png>   where the picture goes (default: $TMPDIR/jobadabra-shot.png)
//   --search <json>    written as config/search.json (a state the demo lacks: the strategy's lists)
//   --theme <light|dark>  the app's theme; the demo's default is dark. The one way: the app's own JOBADABRA_THEME (lib/main-window.js applyTheme), which this option sets and an exported
//                      JOBADABRA_THEME also does. A data-theme attribute set by --js does nothing: the CSS follows Electron's theme source.
//   --settings <json>  merged into the demo's settings.json first (a state the demo lacks: '{"store":"sqlite"}')
// The full reference set is npm run ui-shots (only after big UI changes, or when asked).
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {markSteps} from './shot-mark.mjs';
import {cutFields, cutReport} from './cut-fields.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = path.join(desktop, 'node_modules', '.bin', 'electron');
const args = process.argv.slice(2);
const options = name => args.flatMap((arg, i) => arg === `--${name}` ? [args[i + 1]] : []);
const flag = name => args.includes(`--${name}`);
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const VALUED = ['select', 'mark', 'session', 'js', 'eval', 'output', 'out', 'width', 'settings', 'theme'];
const page = args.find((arg, i) => !arg.startsWith('--') && !VALUED.includes(args[i - 1]?.slice(2))) || 'focus';

const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const expandLog = `if (document.getElementById('ss-log-body').hidden) document.getElementById('ss-expand').click(); ${wait(1500)}`;
const steps = [];
if (page === 'session') {
  steps.push(`document.getElementById('sd-all').click(); ${wait(1500)}`);
  if (option('session')) steps.push(`[...document.querySelectorAll('#ss-list > *')].find(n => n.textContent.includes(${JSON.stringify(option('session'))}))?.click(); ${wait(1000)}`);
  if (flag('log')) steps.push(expandLog);
} else if (page === 'profile') steps.push(`document.querySelector('.nav[data-settings=profile]')?.click(); ${wait(1500)}`);
else steps.push(`document.querySelector('.nav[data-view=${page}]:not([data-settings])')?.click(); ${wait(1500)}`);   // settings: the menu's Settings, not its Profile
if (option('js')) steps.push(option('js'));
// --select: bring the element to the middle at once (the app scrolls smoothly: a rectangle measured mid-scroll crops the wrong part).
if (option('select')) steps.push(`document.querySelector(${JSON.stringify(option('select'))})?.scrollIntoView({block: 'center', behavior: 'instant'}); ${wait(400)}`);
if (options('mark').length) steps.push(markSteps(options('mark')));
const script = code => `(async () => { ${code} })()`;

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-shot-'));
for (const file of fs.readdirSync(path.join(desktop, 'demo'))) if (file !== 'jobs.json') fs.copyFileSync(path.join(desktop, 'demo', file), path.join(data, file));
// --settings '<json>': merged into the demo copy's settings.json, to render a state the demo doesn't have (e.g. '{"store":"sqlite"}').
if (option('settings')) {
  const file = path.join(data, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({...JSON.parse(fs.readFileSync(file, 'utf8')), ...JSON.parse(option('settings'))}, null, 2));
}
// --search '<json>': written as the demo's config/search.json, so the Strategy cards show lists (the demo folder has no search settings of its own).
if (option('search')) {
  fs.mkdirSync(path.join(data, 'config'), {recursive: true});
  fs.writeFileSync(path.join(data, 'config', 'search.json'), option('search'));
}
const out = path.resolve(option('out') || path.join(os.tmpdir(), 'jobadabra-shot.png'));
fs.rmSync(`${out}.json`, {force: true});
// Why (30 Oct 2026; names renamed 1 Nov 2026): the timeout below kills only the `.bin/electron` shim; the app itself ends when this script does (lib/e2e-host.js watchRunner), never left running for days.
const env = {...process.env, JOBADABRA_DEMO: '1', JOBADABRA_E2E_RUNNER_PID: String(process.pid), JOBADABRA_USER_DATA: data, JOBADABRA_SMOKE: out, JOBADABRA_SMOKE_JS: script(steps.join('\n'))};
if (option('theme')) env.JOBADABRA_THEME = option('theme');
if (option('width')) env.JOBADABRA_SHOT_WIDTH = option('width');
if (flag('full')) env.JOBADABRA_SMOKE_FULL = '1';
if (flag('reload')) env.JOBADABRA_SMOKE_RELOAD_JS = script((flag('log') ? expandLog : wait(500)) + (options('mark').length ? markSteps(options('mark')) : ''));   // a reload wipes the frames
if (option('select')) env.JOBADABRA_SMOKE_SELECTOR = option('select');
env.JOBADABRA_SMOKE_EVAL = option('eval') || cutFields(option('select'));
if (flag('no-picture')) env.JOBADABRA_SMOKE_NO_PICTURE = '1';
if (option('output')) env.JOBADABRA_DEMO_OUTPUT = path.resolve(option('output'));
const started = Date.now();
const run = spawnSync(electron, ['.'], {cwd: desktop, env, timeout: 90000, encoding: 'utf8'});
fs.rmSync(data, {recursive: true, force: true});
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (!flag('no-picture')) {
  if (!fs.existsSync(out)) { console.error(`no picture (the steps failed?)\n${(run.stderr || '').split('\n').filter(line => /error/i.test(line)).slice(0, 5).join('\n')}`); process.exit(1); }
  console.log(`${out} (${seconds} s)`);
}
if (option('eval')) console.log(fs.existsSync(`${out}.json`) ? fs.readFileSync(`${out}.json`, 'utf8') : 'no --eval result');
else if (fs.existsSync(`${out}.json`)) for (const line of cutReport(JSON.parse(fs.readFileSync(`${out}.json`, 'utf8')))) console.log(line);

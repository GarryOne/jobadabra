// Screenshots and a short walkthrough video of the app for the website (web/public/images/app/),
// made with the fictional demo data in demo/ so no real profile or job ever appears.
// Run after UI changes: npm run screenshots   (needs ffmpeg for the video: brew install ffmpeg)
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(desktop, '..', 'site', 'public', 'images', 'app');
const electron = path.join(desktop, 'node_modules', '.bin', 'electron');

// Page scripts: show a wizard step with sample input (as a user would have filled it), or open a view.
const step = (name, then = '') => `(() => {
  const steps = ['welcome', 'ai', 'cv', 'draft', 'extras'], i = steps.indexOf('${name}');
  document.querySelectorAll('.step').forEach(s => { s.hidden = s.dataset.step !== '${name}'; });
  document.querySelectorAll('#step-list li').forEach((li, j) => { li.classList.toggle('current', j === i); li.classList.toggle('done', j < i); });
  const $ = id => document.getElementById(id);
  const say = (id, text, tone) => { $(id).textContent = text; $(id).className = 'message ' + tone; };
  ${then}
})()`;
const view = (name, then = '') => `document.querySelector('.nav[data-view=${name}]:not([data-settings])').click(); ${then}`;   // settings: the menu's Settings, not its Profile

const FRAMES = [
  {name: 'welcome', fresh: true, js: step('welcome')},
  {name: 'wizard-ai', fresh: true, js: step('ai', `$('anthropic-key').value = 'sk-ant-api03-demo-key-for-the-screenshot'; say('ai-message', 'Saved ✓', 'ok');`)},
  {name: 'wizard-cv', fresh: true, js: step('cv', `$('cv-name').textContent = '✓ CV_Alex_Morgan.pdf'; $('cv-next').disabled = false;`)},
  {name: 'wizard-strategy', fresh: true, js: step('draft', `$('draft-loading').hidden = true; $('draft-view').hidden = false;
    $('draft-summary').textContent = 'Senior SRE and platform roles in Zurich first, then Switzerland and remote in Europe. Jobs that need fluent German or French are hidden.';
    $('draft-save').disabled = false;`)},
  {name: 'wizard-extras', fresh: true, js: step('extras')},
  {name: 'jobs', js: `(async () => { ${view('jobs')} await new Promise(r => setTimeout(r, 1500)); })()`},  // the app opens on Focus
  {name: 'actions', js: view('actions')},
  {name: 'interviews', js: `(async () => { ${view('interviews')} await new Promise(r => setTimeout(r, 700));
    document.querySelector('.iv-draft button').click(); await new Promise(r => setTimeout(r, 700));
    document.querySelector('main').scrollTop = 0; })()`},
  {name: 'strategy', js: view('strategy')},
  {name: 'settings', js: view('settings')},
  {name: 'schedule', js: view('settings', `document.getElementById('setting-schedule').scrollIntoView()`)},
  {name: 'claude', js: view('settings', `document.querySelector('[data-settings-go=automation]').click(); document.getElementById('setting-claude').scrollIntoView()`)},   // Settings → Automation since 18 Oct 2026
  {name: 'cloud', js: view('settings', `document.getElementById('setting-cloud').scrollIntoView()`)},
];
// On the page: the stills; in the video: the setup, then the app in use.
const STILLS = ['wizard-cv', 'wizard-strategy', 'jobs', 'interviews', 'schedule'];
const VIDEO = FRAMES.map(frame => frame.name);  // every screen, in order: the setup, then the app

const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-frames-'));
fs.mkdirSync(out, {recursive: true});
for (const frame of FRAMES) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-demo-'));
  if (!frame.fresh) for (const file of fs.readdirSync(path.join(desktop, 'demo'))) {
    if (file !== 'jobs.json') fs.copyFileSync(path.join(desktop, 'demo', file), path.join(data, file));
  }
  const png = path.join(frames, `${frame.name}.png`);
  // Why (30 Oct 2026): the timeout kills only the `.bin/electron` shim; the app ends when this script does (lib/e2e-host.js watchRunner).
  const result = spawnSync(electron, ['.'], {cwd: desktop, stdio: 'ignore', timeout: 60000, env: {...process.env,
    JOB_PILOTTO_DEMO: '1', JOB_PILOTTO_E2E_RUNNER_PID: String(process.pid), JOB_PILOTTO_USER_DATA: data, JOB_PILOTTO_SMOKE: png, JOB_PILOTTO_SMOKE_JS: frame.js}});
  fs.rmSync(data, {recursive: true, force: true});
  if (!fs.existsSync(png)) throw new Error(`${frame.name}: no screenshot (exit ${result.status})`);
  execFileSync('sips', ['-z', '1024', '1600', png], {stdio: 'ignore'});  // Retina captures are 2x; one size for all
  console.log(`frame ${frame.name}`);
}
for (const name of STILLS) fs.copyFileSync(path.join(frames, `${name}.png`), path.join(out, `${name}.png`));

// The walkthrough: each screen for 1 s with quick 0.25 s cross-fades (many screens), H.264 so every browser plays it.
const hold = 1, fade = 0.25;
const inputs = VIDEO.flatMap(name => ['-loop', '1', '-t', String(hold + fade), '-i', path.join(frames, `${name}.png`)]);
let chain = '', last = '[0:v]';
for (let i = 1; i < VIDEO.length; i++) {
  const label = i === VIDEO.length - 1 ? '[v]' : `[x${i}]`;
  chain += `${last}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${(i * hold).toFixed(2)}${label};`;
  last = label;
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${chain}[v]scale=1280:-2,format=yuv420p[out]`,
  '-map', '[out]', '-r', '30', '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart',
  path.join(out, 'walkthrough.mp4')]);
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', path.join(frames, 'welcome.png'),
  '--out', path.join(out, 'walkthrough-poster.jpg')], {stdio: 'ignore'});
fs.rmSync(frames, {recursive: true, force: true});
console.log(`wrote ${STILLS.length} screenshots and walkthrough.mp4 to ${path.relative(process.cwd(), out)}`);

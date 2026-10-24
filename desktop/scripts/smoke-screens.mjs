// The one screen both smoke tests (windows-smoke.mjs, mac-smoke.mjs) check in the INSTALLED app: setup done but no Notion key (it can't be made on a runner),
// so the app opens the Jobs list with the rest of the app loaded. A blank or half-built window still saves a picture, so the window also reports what it shows
// (JOB_PILOTTO_SMOKE_EVAL, written beside the screenshot as JSON). Other pages are driven by the e2e suites, from source (owner, 10 Oct 2026).
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DONE = {setupDone: true, autoSearch: false, lastSearchAt: '2099-01-01T00:00:00.000Z',
  notionIds: {NOTION_APPLICATIONS_DB: 'smoke', NOTION_MATCHES_DB: 'smoke', NOTION_PROFILE_PAGE_ID: 'smoke', NOTION_ANSWERS_PAGE_ID: 'smoke'}};
const WAIT_FOR_JOBS = `new Promise(resolve => setTimeout(resolve, 8000))`;
const REPORT = `({view: ([...document.querySelectorAll('.view')].find(v => !v.hidden) || {}).dataset?.view || '', wizard: !document.getElementById('wizard').hidden})`;

// What a `sample` run found the busiest thread doing: its "top of stack" summary (the leaves of the call graph), where a blocking call shows, not the 70 frames above it.
const topOfStack = report => {
  const at = report.indexOf('Sort by top of stack');
  return at < 0 ? report.split('\n').slice(-60).join('\n') : report.slice(at).split('\n').slice(0, 40).join('\n');
};

export async function jobsScreen({exe, out, prefix, say}) {
  const name = 'jobs-without-notion';
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(DONE));
  const png = path.join(out, `${prefix}-${name}.png`);
  // A hard limit (SIGKILL: a quitting app can hang too), the app's own output, and where it is stuck when no screenshot comes: on a bare CI Mac the window once never
  // came (10 Oct 2026). After 20 s without a picture the process is sampled (macOS `sample`) and listed, so a hang names its cause.
  const child = spawn(exe, [], {stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, ELECTRON_ENABLE_LOGGING: '1', JOB_PILOTTO_USER_DATA: userData, JOB_PILOTTO_SMOKE: png, JOB_PILOTTO_SMOKE_JS: WAIT_FOR_JOBS, JOB_PILOTTO_SMOKE_EVAL: REPORT}});
  let text = '';
  child.stdout.on('data', chunk => { text += chunk; });
  child.stderr.on('data', chunk => { text += chunk; });
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({code, signal})));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let stuck = '';
  const result = await Promise.race([exited, wait(20000).then(() => null)]) || await (async () => {
    if (!fs.existsSync(png)) {
      const run = (file, args) => { try { return execFileSync(file, args, {encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024}); } catch (error) { return `(${file}: ${error.message.split('\n')[0]})`; } };
      stuck = process.platform === 'darwin'
        ? `${run('ps', ['-axo', 'pid,ppid,stat,etime,command']).split('\n').filter(line => /Job Pilotto/i.test(line)).join('\n')}\n${topOfStack(run('sample', [String(child.pid), '2']))}`
        : run('tasklist', ['/FI', 'IMAGENAME eq Jobadabra.exe', '/FO', 'LIST']);
    }
    return Promise.race([exited, wait(40000).then(() => { child.kill('SIGKILL'); return exited; })]);
  })();
  const output = `${text}`.trim().split('\n').slice(-25).join('\n');
  if (!fs.existsSync(png) || fs.statSync(png).size < 10000) {
    throw new Error(`${name}: the installed app saved no screenshot (exit ${result.code}, signal ${result.signal}); its last output:\n${output || '(none)'}${stuck ? `\nwhere it was stuck after 20 s:\n${stuck}` : ''}`);
  }
  const reported = fs.existsSync(`${png}.json`) ? JSON.parse(fs.readFileSync(`${png}.json`, 'utf8')) : null;
  if (!reported || reported.error) throw new Error(`${name}: the window answered nothing (${reported ? reported.error : `no ${path.basename(png)}.json`})`);
  if (reported.view !== 'jobs' || reported.wizard !== false) {
    throw new Error(`${name}: expected a set-up app without a Notion token to open the Jobs list, not the wizard, the window reported ${JSON.stringify(reported)}`);
  }
  say(`screen ${name}: opens the Jobs list, not the wizard · ${path.basename(png)} (${Math.round(fs.statSync(png).size / 1024)} KB)`);
}

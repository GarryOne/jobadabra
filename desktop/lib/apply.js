// "Apply to N jobs": pick the N best open jobs and start applying.
//   chrome: open them as tabs in the browser with the extension (Chrome, Edge…); the Jobadabra extension fills each, you submit.
//   agents: one Claude session per job in Terminal (tools/apply-batch-claude.sh), driving Chrome with
//     Claude in Chrome; it follows a job board's Apply to the employer's site, signs up there if asked,
//     and fills every page. Recommended when Claude Code is installed; needs Notion kits.
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pipeline from './pipeline.js';
import {registryPathDirs} from './win-path.js';
import * as session from './claude-session.js';
import * as terminals from './terminals.js';
import {sessionTabUrl} from './session-tab.js';
import {canStart} from './apply-eligibility.js';
import {browserCommand, browserOf} from './browser-launch.js';
import * as extensionInstall from './extension-install.js';
import {log as appLog} from './log.js';
import {expectTab} from './tab-expect.js';
import * as review from './review.js';
import {openFormTab} from './form-tab.js';

export const FILL_MARK = 'jobpilotto-fill'; // must match extension/background.js

// Saved jobs first, then by fit.
const best = (a, b) => (b.status === 'saved') - (a.status === 'saved') || (b.fit ?? -1) - (a.fit ?? -1);
const open = job => ['unreviewed', 'saved'].includes(job.status) && job.url;
const startable = job => open(job) && canStart(job.stage);   // what an Apply batch may take: a job in process is never picked (lib/apply-eligibility.js)

// Only jobs with a drafted kit (their form is already answered), best first.
export function pick(jobs, n) {
  return jobs.filter(job => startable(job) && job.kit).sort(best).slice(0, n);
}

// The best open jobs that still have no kit: what an Apply batch drafts first when fewer than N are ready.
export function pickMissing(jobs, n) {
  return jobs.filter(job => startable(job) && job.code && !job.kit).sort(best).slice(0, n);
}

// What to say when "Tailor CVs for top matches" finds nothing to do: every open job has its CV, or there is no open job at all (then no CV is "ready").
export function nothingToTailor(jobs) {
  return jobs.some(job => open(job) && job.code)
    ? 'Every one of your best matches already has a tailored CV.'
    : 'There are no jobs to tailor CVs for yet. Run Find jobs first.';
}

// The best open jobs without a tailored CV (saved first, then by fit): what "Tailor CVs for top matches" works through.
export function pickUntailored(jobs, n) {
  return jobs.filter(job => open(job) && job.code && !job.tailored).sort(best).slice(0, n);
}

// Draft the missing kits one after the other (about 20 s each). `prepare(code, name)` is the app's prepareKit.
// Returns how many are ready now, or {cloud: true} when they are drafted on GitHub and cannot be waited for here.
export async function draftMissing(jobs, shortfall, prepare, report = () => {}) {
  let done = 0;
  const missing = pickMissing(jobs, shortfall);
  for (const [index, job] of missing.entries()) {
    report(`Drafting kit ${index + 1} of ${missing.length}: ${job.title} · ${job.company} (about 20 s each)…`);
    const result = await prepare(job.code, `${job.title} · ${job.company}`).catch(() => ({ok: false}));
    if (result.cloud) return {cloud: true, done};
    if (result.ok) done++;
  }
  return {done};
}

const NO_KITS = 'No job has an application kit yet, and none could be drafted. Press Apply on one job to see why.';
const ON_GITHUB = 'Kits are being drafted on GitHub (Always on). Press Apply again in a few minutes, when the jobs show 📝 Kit.';

import {formUrl, isFormOf} from './form-address.js';
import {browserData} from './browser-profile.js';
import {readsChanged} from './shared-read.js';
export {formUrl, isFormOf};

// Claude takes a job over in its own tab (claude-in-chrome acts only in its own tab group, so it can't use the extension's tab):
// the job's form session tab closes when nothing was filled in it (a sign-in page, a posting the extension couldn't get past),
// so the application keeps one tab (owner, 8 Oct 2026: Coop's sign-in tab stayed open beside Claude's). A tab with filled
// answers is never closed. `filled(id)`: how many fields the form's reports saw filled.
export function formTabsAtHandOver(sessions, url, filled = () => 0) {
  const job = String(url || '').split('#')[0];
  return sessions.filter(session => session.kind === 'form' && !session.outcome && String(session.url || '').split('#')[0] === job)
    .map(session => ({id: session.id, close: !(filled(session.id) > 0), why: filled(session.id) > 0 ? 'answers filled there' : 'nothing filled'}));
}

// A job keeps one tab (22 Oct 2026: a second press opened a second tab with the same mark, the two flipped as the session's tab and the fill stalled).
// When the session's tab is open (the extension's tab reports), bring it to the front and have it reload: its mark starts the fill again. True when reused.
function reuseOpenTab(session, focus, log) {
  if (review.tabOpen(session) !== true) return false;
  review.queueReload(session);
  Promise.resolve(focus({id: session, boundTab: review.tabOf(session)})).catch(() => {});
  log('apply', 'the job\'s tab is open: focused it and asked it to fill again, no second tab', {session});
  return true;
}

// One job, from its row: open it in Chrome with the fill marker, so the extension fills the form by itself.
// `reuse`: the job's own form (not another address, like a confirmation link) goes to its open tab instead of a second one.
export function openOne(url, {session = '', open = spawn, log = appLog, reuse = false, focus = openFormTab} = {}) {
  if (!/^https?:\/\//.test(url || '')) return {ok: false, error: 'This job has no link to open.'};
  if (!session) return {ok: false, error: 'A form tab is opened for a session; none was given.'};   // every tab the app opens is owned from its first page (spec 2026-10-12-tab-owned.md)
  if (reuse && reuseOpenTab(session, focus, log)) return {ok: true, reused: true};
  const chrome = chromeCommand([sessionTabUrl(formUrl(url), session)], process.platform, process.env, fs.existsSync, extensionBrowser());
  if (!chrome) { log('apply', 'no browser found to open the form tab', {platform: process.platform}); return {ok: false, error: NO_CHROME}; }
  const child = open(...chrome, {detached: true, stdio: 'ignore'});
  let host = ''; try { host = new URL(url).hostname; } catch { /* no host */ }
  log('apply', 'opened the form tab', {session, host, mark: true, browser: browserOf(chrome) || String(chrome[0]).split(/[\\/]/).pop()});
  child?.on?.('error', error => log('apply', 'opening the form tab failed', {session, error: String(error?.message || error).slice(0, 200)}));   // a bad browser path would otherwise crash or vanish
  child?.unref?.();
  expectTab(session);   // the extension must bind this tab to the session soon (lib/tab-expect.js)
  return {ok: true};
}

// The Apply button: the form tab, and a form session for it in the Applying page (the job goes to Applying in Notion, like an
// Apply with Claude session). The session shows what is left in the form from the extension's reports and moves to Applied
// when the extension sees the submit. Pressing Apply on a job that already has an open form session reopens only the tab.
export async function applyOne(storage, url, details = {}, {open = spawn, term = terminals, run = pipeline.run, id = () => crypto.randomUUID().slice(0, 8), focus = openFormTab} = {}) {
  if (!/^https?:\/\//.test(url || '')) return {ok: false, error: 'This job has no link to open.'};
  const fresh = !term.list().some(s => s.url === url.split('#')[0] && s.kind === 'form' && !s.outcome);
  // The session first (an open one on this job is reused), then its tab, which carries the session's id.
  const session = term.startForm({id: id(), url: url.split('#')[0], title: details?.title || '', company: details?.company || '',
    location: details?.location || '', workMode: details?.workMode || ''});
  const opened = openOne(url, {session: session.id, open, focus, reuse: true});
  if (!opened.ok) { if (fresh) term.remove(session.id); return opened; }
  // A stage write, done before Apply answers: the window then reads the list again and counts the job as Applying (#1737); reads after it start their own.
  if (fresh) await run(storage, ['src.ai.apply_batch', '--mark-applying', url.split('#')[0]]).then(readsChanged).catch(() => {});
  return {ok: true, session};
}

const NO_CHROME = 'No supported browser was found. Install Chrome or Edge (with the Jobadabra extension) to fill applications.';

// How to open URLs in the browser that has the extension (Chrome, Edge, Brave, Vivaldi): see browser-launch.js.
// `prefer` is that browser's app name. null when none is installed.
export const chromeCommand = browserCommand;

// The browser a form would open in now (the extension's, else Chrome, else Edge…), as an app name, for the wording of the install steps.
export function launchBrowser(find = extensionInstall.installed, command = browserCommand) {
  return extensionBrowser(find) || browserOf(command(['x'], process.platform, process.env, fs.existsSync)) || 'Google Chrome';
}

// The browser the Jobadabra extension is installed in, enabled, for a form to open in: the copy loaded from the app's own
// folder first. '' when none is found (Chrome, then Edge, is tried).
export function extensionBrowser(find = extensionInstall.installed) {
  try {
    const found = find({folder: path.join(pipeline.REPO, 'extension')}).filter(copy => copy.enabled);
    return (found.find(copy => copy.current) || found[0])?.app || '';
  } catch { return ''; }
}

// Where the Claude Code installer and Homebrew put `claude`: an app opened from the Finder has no shell PATH.
// On Windows: claude.exe (native installer, ~/.local/bin) or claude.cmd (npm, %APPDATA%\npm).
export function claudeSearchDirs(env = process.env, platform = process.platform, registry = registryPathDirs) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const home = env.USERPROFILE && platform === 'win32' ? env.USERPROFILE : os.homedir();
  // The registry's PATH too (lib/win-path.js): a Claude Code installed after this app started is on it, not on process.env.PATH.
  return [...String(env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean), ...(env === process.env ? registry({env, platform}) : []),
    p.join(home, '.local', 'bin'), p.join(home, '.claude', 'local'),
    ...(platform === 'win32' ? [env.APPDATA && p.join(env.APPDATA, 'npm')].filter(Boolean) : ['/opt/homebrew/bin', '/usr/local/bin'])];
}
export function claudeBinary(env = process.env, exists = fs.existsSync, platform = process.platform, registry = registryPathDirs) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  return claudeSearchDirs(env, platform, registry).flatMap(dir => names.map(name => p.join(dir, name))).find(file => exists(file)) || '';
}

// Git for Windows: Claude Code on Windows runs its commands in its bash. Where the installer puts it, or
// where CLAUDE_CODE_GIT_BASH_PATH says.
export function gitBash(env = process.env, exists = fs.existsSync) {
  return [env.CLAUDE_CODE_GIT_BASH_PATH, env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe')].filter(Boolean).find(file => exists(file)) || '';
}

// Signed in to Claude Code: its settings file names the Claude account after `claude` → /login.
export function claudeSignedIn(home = os.homedir(), read = fs.readFileSync) {
  try { return !!JSON.parse(read(path.join(home, '.claude.json'), 'utf8')).oauthAccount; } catch { return false; }
}

// The Claude in Chrome extension (Chrome Web Store id), found in any Chrome profile's Extensions folder. Whether it's
// signed in can't be seen from here; installed is what we can check.
export const CLAUDE_IN_CHROME = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
export function chromeProfiles(platform = process.platform, home = os.homedir(), env = process.env) {
  if (env.JOB_PILOTTO_BROWSER_DATA) return path.join(browserData(platform, env), 'Google', 'Chrome');   // the e2e harness's own folder, never the owner's
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  return path.join(home, '.config', 'google-chrome');
}
export function claudeInChrome(root = chromeProfiles(), list = dir => fs.readdirSync(dir)) {
  try {
    return list(root).some(profile => { try { return list(path.join(root, profile, 'Extensions')).includes(CLAUDE_IN_CHROME); } catch { return false; } });
  } catch { return false; }
}

// What Apply with Claude needs that only the user can set up, for the wizard's checklist.
export function claudePrereqs(platform = process.platform, {binary = claudeBinary, signedIn = claudeSignedIn, bash = gitBash, chrome = claudeInChrome} = {}) {
  return {claude: !!binary(), signedIn: signedIn(), git: platform === 'win32' ? !!bash() : null, windows: platform === 'win32', chrome: chrome()};
}

// Apply with Claude works when Claude Code is installed (with Git for Windows there) and Notion holds the kits.
// Sessions start from lib/claude-session.js: Terminal on the Mac, a console window on Windows.
export function claudeReady(storage, binary = claudeBinary, platform = process.platform, bash = gitBash) {
  if (!binary()) return {ok: false, error: 'Apply with Claude needs Claude Code: install it from claude.com/claude-code, or use Fill in Chrome.'};
  if (platform === 'win32' && !bash()) return {ok: false, error: 'Apply with Claude on Windows needs Git for Windows (git-scm.com), which Claude Code uses. Or use Fill in Chrome.'};
  if (!storage.secret('NOTION_TOKEN')) return {ok: false, error: 'Apply with Claude reads the kit from Notion. Connect Notion in Settings first, or use Fill in Chrome.'};
  return {ok: true};
}

// The job's kit in Notion (answers and cover letter): a Claude session has nothing to fill from without it.
export async function hasKit(storage, url, run = pipeline.run) {
  const lines = [];
  const {code} = await run(storage, ['src.ai.apply_batch', '--has-kit', url], line => lines.push(line));
  return code === 0 ? {ok: true} : {ok: false, error: `No application kit for this job yet: draft it first with ⋯ → Prepare only. ${lines.slice(-1)[0] || ''}`.trim()};
}

// The N best jobs with a kit that aren't started yet (Kit ready, or Saved with a kit), from Notion.
// The best n jobs with a kit: their URLs, with the title and company of each (details) for its session card.
export async function nextWithKits(storage, n, run = pipeline.run) {
  const {code, stdout} = await run(storage, ['src.ai.apply_batch', '--next', String(n), '--details']);
  // One JSON line per job (--details); a plain link line (an older pipeline) is read as a job without details.
  const jobs = code === 0 ? stdout.split(/\r?\n/).map(line => line.trim()).map(line => { try { return JSON.parse(line); } catch { return {url: line}; } })
    .filter(job => /^https?:\/\//.test(job?.url || '')) : [];
  const urls = jobs.map(job => job.url);
  urls.details = Object.fromEntries(jobs.map(({url, ...rest}) => [url, rest]));
  return urls;
}

// One job, from its row: a Claude session in its own window takes it from the posting to a filled form.
// Sessions run inside the app unless Settings says Terminal windows, or the terminal module can't load.
export async function inApp(storage, available = terminals.available) {
  return storage.settings().sessionsInApp !== false && await available();
}

// The app opens no tab for an Apply with Claude session. claude-in-chrome acts only on tabs in its own group and
// cannot see one the app opened (tabs_context_mcp: "No tab group exists for this session"), so Claude made a second
// tab, without the mark, beside the app's (1 Oct 2026). The session opens the one tab itself, with #jobpilotto-fill.
const openForm = () => {};

export async function claudeOne(storage, url, launch = session.launch, binary = claudeBinary, kit = hasKit, details = null) {
  if (!/^https?:\/\//.test(url || '')) return {ok: false, error: 'This job has no link to open.'};
  const ready = claudeReady(storage, binary);
  if (!ready.ok) return ready;
  const drafted = await kit(storage, url);
  if (!drafted.ok) return drafted;
  // A launcher passed in (tests, the Terminal fallback) is used as given; the app's default is the in-app terminal.
  if (launch === session.launch && await inApp(storage)) {
    const [started] = await session.launchInApp(storage, [url.split('#')[0]], {claude: binary(), open: openForm, details: details ? {[url.split('#')[0]]: details} : {}});
    return {ok: true, session: started};
  }
  await launch(storage, [url.split('#')[0]], {claude: binary(), open: openForm});
  return {ok: true};
}

// A session that isn't running (the app was closed and reopened): Claude again, in its conversation.
export async function resumeSession(storage, id, binary = claudeBinary) {
  const ready = claudeReady(storage, binary);
  if (!ready.ok) return ready;
  return session.resumeInApp(storage, id, {claude: binary()});
}

// `prepare` drafts a missing kit (the app's prepareKit): with it, a batch with fewer than N ready jobs drafts the rest first.
// mode 'background' (Background or Full automation, applyMode 'fill'/'auto'): the chosen jobs go to `enqueue` (the hidden browser's queue, lib/background-apply-controller.js).
export async function start(storage, {n, mode, applyMode}, open = spawn, list = pipeline.jobs, launch = session.launch, next = nextWithKits, prepare = null, report = () => {}, {focus = openFormTab, enqueue = null} = {}) {
  n = Math.max(1, Math.min(10, Number(n) || 1));
  if (mode === 'agents') {
    const ready = claudeReady(storage);
    if (!ready.ok) return ready;
    let urls = await next(storage, n);
    let drafted = 0;
    if (urls.length < n && prepare) {
      const result = await draftMissing((await list(storage)).jobs, n - urls.length, prepare, report);
      if (result.cloud) return {ok: false, error: ON_GITHUB};
      drafted = result.done;
      if (drafted) urls = await next(storage, n);
    }
    if (!urls.length) return {ok: false, error: NO_KITS};
    const here = launch === session.launch && await inApp(storage);
    (here ? session.launchInApp(storage, urls, {claude: claudeBinary(), open: openForm, details: urls.details || {}}) : launch(storage, urls, {claude: claudeBinary(), open: openForm})).catch(() => {});
    n = urls.length;
    const first = drafted ? `Drafted ${drafted} kit${drafted === 1 ? '' : 's'} first. ` : '';
    return {ok: true, inApp: here, message: first + (here
      ? `Starting ${n} Claude session(s) in the app, a few seconds apart. Each shows in Application sessions at the bottom; you're notified when one needs you. It stops before Submit for your review.`
      : `Starting ${n} Claude session(s), one window per job. Each reads sign-up emails itself, asks you in its window for a CAPTCHA, and stops before Submit for your review.`)};
  }
  let {jobs} = await list(storage);
  let chosen = pick(jobs, n);
  let drafted = 0;
  if (chosen.length < n && prepare) {
    const result = await draftMissing(jobs, n - chosen.length, prepare, report);
    if (result.cloud) return {ok: false, error: ON_GITHUB};
    drafted = result.done;
    if (drafted) { ({jobs} = await list(storage)); chosen = pick(jobs, n); }
  }
  if (!chosen.length) return {ok: false, error: NO_KITS};
  // Why (2026-10-28, Background apply B): a hidden-browser mode never falls through to the visible Chrome launcher, even when nothing was handed in.
  if (mode === 'background') return enqueue ? enqueue(chosen, applyMode) : {ok: false, error: 'Background applying is not available in this version.'};
  // The marker tells the extension to fill each tab by itself as it loads, all tabs in parallel. Each job gets its own form session first, so each tab carries its id.
  const owners = chosen.map(job => terminals.startForm({id: crypto.randomUUID().slice(0, 8), url: job.url.split('#')[0], title: job.title || '', company: job.company || '',
    location: job.location || '', workMode: job.workMode || ''}));
  const toOpen = chosen.map((job, index) => [job, owners[index]]).filter(([, owner]) => !reuseOpenTab(owner.id, focus, appLog));   // a job whose tab is open keeps it
  const chrome = toOpen.length ? chromeCommand(toOpen.map(([job, owner]) => sessionTabUrl(job.url, owner.id)), process.platform, process.env, fs.existsSync, extensionBrowser()) : [];
  if (!chrome) { toOpen.forEach(([, owner]) => terminals.remove(owner.id)); return {ok: false, error: NO_CHROME}; }   // no tab will carry these sessions' ids (applyOne does the same); a reused tab keeps its session
  if (toOpen.length) open(...chrome, {detached: true, stdio: 'ignore'}).unref();
  return {ok: true, jobs: chosen.map(job => `${job.title} · ${job.company}`),
    message: `${drafted ? `Drafted ${drafted} kit${drafted === 1 ? '' : 's'} first. ` : ''}Opened ${chosen.length} job(s) in Chrome; each fills itself in a few seconds. Review every tab and submit yourself. ` +
      '(If a form sits behind an "Apply" button, open it and click ✈️ → Fill with AI.)'};
}

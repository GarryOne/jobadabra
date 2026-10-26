// Refused sites read in the user's own Chrome (owner, 19 Oct 2026; src/sources/refused_reads.py is the engine side, extension/refused-read.js the browser side).
// Unless Settings → "Read refused sites in my browser" was turned off (ON by default since 20 Oct 2026, owner: "opt-out"): the extension asks for the sites that refused the engine, fetches each once
// without cookies, and sends the page; this file hands the engine's queue out, passes each page to the engine, and shows the pass as one Recent activity row
// (kind 'visits', one site line per site, the same card as "Find jobs using your browser"). Turned off means the engine is never asked. Guard: test/refused-reads.test.js.
import * as pipeline from './pipeline.js';
import {engineJson, siteLine, resultMessage} from './visits.js';
import {log as appLog} from './log.js';
import * as now from './refused-now.js';

export const settingOn = storage => storage.settings().readRefusedSites !== false;
export const PASS_MS = 15 * 60 * 1000;   // a pass the extension never finishes (Chrome closed) ends here, with what it brought
// A site the browser gives no answer for within this time ends the pass with that reason: the ladder (download, then a real tab of up to ~15 s,
// each judged by the engine) answers well within it; a captcha held for the person is an answer ("needs a quick check"), not a wait.
export const SITE_MS = 45 * 1000;
let pass = null;   // {sites, expected, results, fits, tee, over, resolve, ...}
let stopped = false;   // Stop ended the pass: the extension's next page report answers `stop`, and it reads no further site (25 Oct 2026)

export const passRunning = () => !!pass;

// The extension asks what to read: [] when the setting is off, a pass is running, or nothing is due (never asks the engine when off).
export async function queue(storage, {allowed = true, incognito = true, log = () => {}, run = pipeline.run, work = pipeline.work, allowanceBlock = () => false, scoreArgs = pipeline.visitsArgs, siteMs = SITE_MS} = {}) {
  const off = {ok: true, on: false, sites: []};
  if (!settingOn(storage)) return off;
  if (!!storage.settings().refusedNeedsAllow === allowed) storage.saveSettings({refusedNeedsAllow: !allowed});   // Settings says "Allow all sites in the extension once"
  if (!!storage.settings().refusedNeedsIncognito === incognito) storage.saveSettings({refusedNeedsIncognito: !incognito});   // Settings says "Allow in Incognito" for the private-window step
  if (incognito && storage.settings().refusedIncognitoWaiting?.length) storage.saveSettings({refusedIncognitoWaiting: []});   // the switch is on: nothing waits for it
  if (!allowed || pass) return {...off, on: true};
  let sites = [];
  try {
    const asked = now.take();   // Read now: these sites are due at once (src/sources/refused_reads.py queue)
    const {stdout} = await run(storage, ['src.desktop', 'refused-queue', ...(asked.all ? ['--all'] : []), ...asked.hosts.flatMap(host => ['--now', host])]);
    sites = JSON.parse(String(stdout).trim().split('\n').pop()).sites || [];
  } catch { sites = []; }
  if (!sites.length) return {...off, on: true};
  appLog('refused-reads', 'pass started', {sites: sites.length});
  stopped = false;
  // The pass exists from the moment the extension has the sites, which it reads at once; its task may wait its turn behind another
  // (one at a time, lib/pipeline-queue.js), so the pages that come back meanwhile are kept and shown when it starts (owner, 26 Oct 2026:
  // "it hangs": Airbase came back at 02:32, the pass started at 02:43 behind Find jobs and waited 15 minutes for it).
  const state = {sites, expected: sites.length, results: [], fits: 0, early: [], over: false, resolve: null, signal: null, run, storage, allowanceBlock, scoreArgs, siteMs};
  state.tee = line => state.early.push(line);
  const overall = setTimeout(() => end(state), PASS_MS);
  overall.unref?.();
  let siteTimer = null;
  state.deadline = () => { clearTimeout(siteTimer); siteTimer = setTimeout(() => timedOut(state), siteMs); siteTimer.unref?.(); };   // each site gets siteMs from the last answer
  state.clear = () => { clearTimeout(siteTimer); clearTimeout(overall); };
  pass = state;
  state.deadline();
  state.tee(`Reading ${sites.length} refused site${sites.length === 1 ? '' : 's'} in your browser, 1 at a time`);
  sites.forEach(site => state.tee(siteLine('next', site.name, site.url)));
  work(storage, 'visits', log, (tee, signal) => new Promise(resolve => {
    state.early.forEach(line => tee(line));
    Object.assign(state, {tee, resolve, signal});
    signal?.addEventListener('abort', () => { stopped = true; end(state); }, {once: true});   // Stop: the pass ends now, the extension is told with its next report
    if (state.over) report(state);
  })).catch(error => appLog('refused-reads', 'pass failed', {error: error.message}));
  return {ok: true, on: true, sites};
}

// One page the extension fetched: the engine keeps its jobs (or the stop), and the site's line says which.
export async function outcome(storage, payload, {run = pipeline.run} = {}) {
  if (!settingOn(storage)) return {ok: false, error: 'off'};
  const url = String(payload?.url || '');
  if (!/^https:\/\//.test(url)) return {ok: false, error: 'no page address'};
  if (payload?.tabSkipped === 'incognito') {   // the ladder stopped at the real tab for want of Allow in Incognito: Focus says how many sites wait for that one switch
    const waiting = new Set(storage.settings().refusedIncognitoWaiting || []);
    waiting.add(now.hostOf(url));
    storage.saveSettings({refusedIncognitoWaiting: [...waiting].slice(0, 200)});
  }
  const body = {url, status: Number(payload.status) || 0, html: String(payload.html || '').slice(0, 3_000_000), title: String(payload.title || '').slice(0, 300), final: String(payload.final || '').slice(0, 500), step: ['engine', 'download', 'tab'].includes(payload.step) ? payload.step : 'download', captcha: payload.captcha === true};   // words-ok: the engine AI's fixed page_state answer, not a page's words
  const answer = await engineJson(storage, 'refused-outcome', body, run).catch(() => null);
  const name = answer?.name || new URL(url).hostname;
  keepCheckWaiting(storage, url, answer);
  appLog('refused-reads', 'site fetched in your browser', {host: new URL(url).hostname, state: answer?.state || 'failed', jobs: answer?.jobs ?? null});
  if (!pass) return stopped ? {...(answer || {ok: false}), stop: true} : answer || {ok: false};
  const jobs = answer?.jobs || 0;
  const ok = !!answer?.ok && answer.state === 'read';
  pass.results.push({name, url, ok, jobs, added: jobs, fits: answer?.fits || 0, why: ok ? '' : answer?.why || (answer?.state === 'empty' ? 'no jobs found' : answer?.state === 'skipped' ? answer.why : 'not read')});
  pass.fits += answer?.fits || 0;
  pass.tee(siteLine(ok ? 'done' : 'stopped', name, ok ? `${jobs} job${jobs === 1 ? '' : 's'} read` : pass.results.at(-1).why));
  if (pass.results.length >= pass.expected) await end(pass); else pass.deadline();
  return answer || {ok: false};
}

// What a page in the extension's real tab is now (page, passive_check, captcha, login, refused): the engine's AI answers, the extension waits or stops on it.
export async function judge(storage, payload, {run = pipeline.run} = {}) {
  if (!settingOn(storage)) return {ok: false, error: 'off'};
  const body = {url: String(payload?.url || '').slice(0, 500), status: Number(payload?.status) || 0, html: String(payload?.html || '').slice(0, 60000), title: String(payload?.title || '').slice(0, 300), final: String(payload?.final || '').slice(0, 500)};
  const answer = await engineJson(storage, 'refused-judge', body, run).catch(() => null);
  return {ok: !!answer?.ok, state: answer?.state || 'refused'};   // no answer: a stop, never a guess that it cleared
}

export const done = () => pass && end(pass);   // the extension's pass ended (some sites left unread when Chrome stops)

// The pass is over (every site answered, a site's time ran out, Stop, Chrome ended it, or PASS_MS): a new pass may start; its task reports
// now, or as soon as its turn in the queue comes.
function end(state) {
  if (state.over) return undefined;
  state.over = true;
  state.clear();
  if (pass === state) pass = null;
  return state.resolve ? report(state) : undefined;
}

// No answer for a site within siteMs: it and the sites after it are listed with that reason, and the extension's next report says stop.
function timedOut(state) {
  if (state.over) return;
  const answered = new Set(state.results.map(result => result.url));
  const why = `no answer from your browser in ${Math.round(state.siteMs / 1000)} s`;
  for (const site of state.sites.filter(site => !answered.has(site.url))) {
    state.results.push({name: site.name, url: site.url, ok: false, jobs: 0, added: 0, fits: 0, why});
    state.tee(siteLine('stopped', site.name, why));
  }
  appLog('refused-reads', 'site timed out', {why});
  stopped = true;
  end(state);
}

async function report(state) {
  const {tee, signal, run, storage} = state;
  let scored = null;
  if (state.fits && !state.allowanceBlock() && !signal?.aborted) {   // stopped: the pages read are kept, the next jobs check scores them. The matching jobs are scored and listed in this run's turn, like Find jobs using your browser
    tee(`Scoring the ${state.fits} matching job${state.fits === 1 ? '' : 's'} for your Jobs list…`);
    const {stdout = ''} = await run(storage, state.scoreArgs(storage, state.fits), tee).catch(() => ({stdout: ''}));
    scored = /Job Matches: (\d+) created/.exec(String(stdout))?.[1] ?? null;
  }
  const text = resultMessage(state.results, {added: scored === null ? null : Number(scored)});
  tee(text.split('\n')[1]);
  tee('<<<message'); text.split('\n').forEach(line => tee(line)); tee('message>>>');
  state.resolve(state.results.some(result => result.ok));
}

// The person pressed "Open Chrome's switch" (Settings or Focus): the flag lives in settings, the extension's one-minute look takes it once and opens its own details page.
export function takeOpenSwitch(storage) {
  if (!storage.settings().refusedOpenSwitch) return false;
  storage.saveSettings({refusedOpenSwitch: false});
  return true;
}

// A captcha is held in the extension's hidden window (extension/refused-held.js): Focus offers "Show the check" while it is (owner, 21 Oct 2026). {host, at} per site; a read of the site ends it.
export const CHECK_WAIT_MS = 12 * 60 * 1000;   // a little longer than the extension holds the window
function keepCheckWaiting(storage, url, answer) {
  const host = now.hostOf(url), kept = (storage.settings().refusedCheckWaiting || []).filter(entry => entry.host !== host && Date.now() - entry.at < CHECK_WAIT_MS);
  if (answer?.needs_check) kept.push({host, at: Date.now()});
  if (answer?.needs_check || kept.length !== (storage.settings().refusedCheckWaiting || []).length) storage.saveSettings({refusedCheckWaiting: kept.slice(-20)});
}
// The person pressed "Show the check": handed to the extension's one-minute look once.
export function takeShowCheck(storage) {
  if (!storage.settings().refusedShowCheck) return false;
  storage.saveSettings({refusedShowCheck: false});
  return true;
}

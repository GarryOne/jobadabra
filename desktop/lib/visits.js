// Sites only you can open (owner, 7 Oct 2026): employers whose job site refuses automated visitors and portals with no API (LinkedIn,
// Indeed, Glassdoor). The app opens the page in the browser that has the extension; the person, as themselves, presses "Read the jobs" in
// the extension, which sends each page it sees here; the engine reads it (src/sources/visits.py) and the next jobs check scores it.
import {aiNameOf} from './ai/names.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromeCommand, extensionBrowser, launchBrowser} from './apply.js';
import {focusTabAt, focusTabById} from './form-tab.js';
import * as pipeline from './pipeline.js';
import {log} from './log.js';
import {cutShort, resultMessage} from './visit-result.js';

const NO_BROWSER = 'No Chrome (or Edge, Brave, Vivaldi) found to open it in. Install Chrome and the Jobadabra extension.';

export function open(url, run = spawn) {
  url = String(url || '').replace(/^http:\/\//i, 'https://');   // a scout's plain-http address (Tag Heuer, Hublot, 7 Oct 2026): opened as https
  if (!/^https:\/\//.test(url)) return {ok: false, error: 'This site has no address to open.'};
  const command = chromeCommand([url], process.platform, process.env, fs.existsSync, extensionBrowser());
  if (!command) return {ok: false, error: NO_BROWSER};
  run(...command, {detached: true, stdio: 'ignore'}).unref();
  log('visit', 'opened a site only the user can open', {host: new URL(url).hostname, decidedBy: 'user click'});
  return {ok: true};
}

// The Find jobs using your browser task's own log (owner's Technical log): while it runs, what the engine says for each page goes there too (another session's
// report, 7 Oct 2026: its log showed 4 lines and "no new output for 5 min" while visit-filters ran 130 s, printing only to app.log).
let taskTee = null;
// Indented: kept in the log as detail, never the task's running step (pipeline isProgressStep skips indented lines); the step is runAll's own.
const onLine = line => { if (taskTee && String(line).trim()) taskTee(`  ${String(line).trim()}`); };
export const FILTER_WAIT_MS = 20000;   // Claude's filter choice: past this, the page is read as it is (it once took 130 s on LinkedIn; a site has 60 s in all)

// Any engine command that takes one JSON file (a page outline, a site's recipe): its last stdout line as JSON, or null.
export async function engineJson(storage, command, body, runEngine = pipeline.run) {
  const file = path.join(os.tmpdir(), `jp-${command}-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(body));
  try {
    const {stdout} = await runEngine(storage, ['src.desktop', command, file], onLine, {}, {inTask: 'visits'});   // inTask: Stop on the run ends this command too
    try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return null; }
  } finally {
    fs.rmSync(file, {force: true});
  }
}

// A browser run's results to the engine: a site that failed twice in a row is offered unticked with why (src/sources/visits.py outcome).
export async function remember(storage, results, runEngine) {
  const body = (results || []).map(result => ({url: String(result.url || result.start || ''), ok: !!result.ok, why: String(result.why || '').slice(0, 160)}));
  const answer = await engineJson(storage, 'visit-outcome', body, runEngine).catch(() => null);
  log('visit', 'run results remembered', {sites: body.length, failed: body.filter(result => !result.ok).length, ok: !!answer?.ok});
}

// A page the quick guess could not read: Claude makes a recipe from its outline (src/ai/visit_reader.py), kept per site.
export async function understand(storage, outline, runEngine) {
  if (!/^https?:\/\//.test(String(outline?.url || ''))) return {ok: false, error: 'no page address'};
  const answer = await whileThinking(String(outline.ticket || ''), engineJson(storage, 'visit-understand', {url: String(outline.url), title: String(outline.title || '').slice(0, 200),
    groups: Array.isArray(outline.groups) ? outline.groups.slice(0, 12) : [], pager: Array.isArray(outline.pager) ? outline.pager.slice(0, 25) : []}, runEngine));
  log('visit', 'recipe asked of the AI', {host: new URL(outline.url).hostname, groups: outline.groups?.length || 0, found: !!answer?.recipe, next: answer?.recipe?.next});
  // What Claude's reading found, in the task's log (owner, 7 Oct 2026: "are we getting enough details of what's happening in each tab?")
  onLine(`  The AI's reading of ${new URL(outline.url).hostname}: ${answer?.recipe ? `a job list found (next page: ${answer.recipe.next || 'none'})` : `no job list found among the page's ${outline.groups?.length || 0} groups of repeated items`}`);
  return answer || {ok: false, error: 'The app could not read this page.'};
}

// A page that is not a job list (a home page): the job list's address, from its own links or the AI link chooser; kept per site.
export async function jobPage(storage, page, runEngine) {
  heardFrom(page?.ticket);
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false};
  const answer = await whileThinking(String(page.ticket || ''), engineJson(storage, 'visit-jobpage', {url: String(page.url), html: String(page.html || '').slice(0, MAX_HTML)}, runEngine));
  log('visit', 'job list looked for on a page that is not one', {host: new URL(page.url).hostname, found: !!answer?.url});
  return answer || {ok: false};
}

// Before the tabs open: each employer's job page, by a "<company> jobs" web search when not known yet (owner, 7 Oct 2026: "go correctly to
// the jobs page, not the home page"). The sites come back with their job page as address; one with none keeps its own.
export async function withJobPages(storage, sites, tee = () => {}, runEngine) {
  const employers = sites.filter(site => site.kind !== 'portal');
  if (!employers.length) return sites;
  tee(`Finding the job page of ${employers.length} employer${employers.length === 1 ? '' : 's'}…`);
  const answer = await engineJson(storage, 'visit-jobpages', employers.map(site => ({name: site.name, url: site.url, kind: site.kind})), runEngine).catch(() => null);
  const pages = answer?.pages || {};
  log('visit', 'job pages looked up before reading', {sites: employers.length, found: Object.keys(pages).length});
  return sites.map(site => (pages[site.url] ? {...site, url: pages[site.url]} : site));
}

// What a Read with Claude session saved: its pages went to the engine under the session name read_<id>.json (claude-session.js readPrompt).
export async function claudeResult(storage, id, runEngine = pipeline.run) {
  const {stdout} = await runEngine(storage, ['src.desktop', 'visit-session', `read_${id}.json`], onLine);
  try { return JSON.parse(String(stdout).trim().split('\n').pop()).result || null; } catch { return null; }
}

// The recipe kept for a site (or forget it: it found nothing; or `missed`: it found nothing on a page that may have no jobs).
export async function recipe(storage, page, runEngine) {
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false};
  if (page.forget) log('visit', 'recipe found nothing: learned again next time', {host: new URL(page.url).hostname});
  const answer = (await engineJson(storage, 'visit-recipe', {url: String(page.url), forget: !!page.forget, missed: !!page.missed}, runEngine)) || {ok: false};
  if (page.missed) log('visit', 'recipe found no jobs on a page with no list', {host: new URL(page.url).hostname, forgot: !!answer.forgot});
  return answer;
}

// A page with no job list even after Claude's reading: at most two steps toward it, or "needs you" (src/ai/visit_unblock.py). Claude's time is
// not silence. Each decision is logged with what it rested on (labels and counts, never the page's text).
export async function unblock(storage, page, runEngine) {
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false, error: 'no page address'};
  const ways = Array.isArray(page.ways) ? page.ways.slice(0, 120) : [];
  const answer = await whileThinking(String(page.ticket || ''), engineJson(storage, 'visit-unblock', {url: String(page.url), title: String(page.title || '').slice(0, 200),
    text: String(page.text || '').slice(0, 800), ways}, runEngine));
  log('visit', 'the AI asked for a way to the jobs', {host: new URL(page.url).hostname, ways: ways.length, decidedBy: aiNameOf(storage), steps: (answer?.steps || []).map(step => `${step.action} ${step.label}`).join(' | ').slice(0, 200), needsYou: answer?.needs_person || ''});
  onLine(`  The AI's way to the jobs on ${new URL(page.url).hostname}: ${answer?.needs_person ? `it needs you (${answer.needs_person})` : answer?.steps?.length ? answer.steps.map(step => `${step.action} "${step.label.slice(0, 40)}"`).join(', ') : 'none found'}`);
  return answer || {ok: false, error: 'The AI could not find a way to the jobs.'};
}

// The page's filter controls: which to set for this person's search (src/ai/visit_filters.py, through the engine's AI). Labels in the log.
export async function filters(storage, page, runEngine = pipeline.run) {
  heardFrom(page?.ticket);
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false, error: 'no page address'};
  const file = path.join(os.tmpdir(), `jp-visit-filters-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({url: String(page.url), title: String(page.title || '').slice(0, 300), controls: Array.isArray(page.controls) ? page.controls.slice(0, 200) : []}));
  try {
    const late = new Promise(resolve => setTimeout(() => resolve({late: true}), FILTER_WAIT_MS));
    const ran = await whileThinking(String(page.ticket || ''), Promise.race([runEngine(storage, ['src.desktop', 'visit-filters', file], onLine, {}, {stopAfterMs: FILTER_WAIT_MS + 2000}), late]));
    if (ran.late) {
      log('visit', 'filters: the AI took too long, the page is read as it is', {host: new URL(page.url).hostname, waitedMs: FILTER_WAIT_MS});
      onLine(`Filters for ${new URL(page.url).hostname}: the AI took over ${FILTER_WAIT_MS / 1000} s, so the page is read as it is`);
      return {ok: false, error: `The AI took over ${FILTER_WAIT_MS / 1000} s to choose the filters: reading the page as it is`};
    }
    const answer = (() => { try { return JSON.parse(String(ran.stdout).trim().split('\n').pop()); } catch { return null; } })();
    log('visit', 'filters chosen', {host: new URL(page.url).hostname, steps: answer?.steps?.length ?? null, labels: (answer?.steps || []).map(step => step.label).join(' | ').slice(0, 300)});
    return answer || {ok: false, error: 'The app could not choose the filters.'};
  } finally {
    fs.rmSync(file, {force: true});
  }
}

// "Go to Chrome and allow" (owner, 7 Oct 2026: "the app should explicitly say it, with a call to action"): the browser with the extension to the
// front, where the extension's Allow page is the active tab.
export function focusBrowser(run = spawn, platform = process.platform) {
  const app = launchBrowser();
  if (platform === 'darwin') run('open', ['-a', app], {detached: true, stdio: 'ignore'}).unref();
  else { const command = chromeCommand([], platform, process.env, fs.existsSync, extensionBrowser()); if (command) run(...command, {detached: true, stdio: 'ignore'}).unref(); }
  log('visit', 'brought the browser forward for the Allow', {app, decidedBy: 'user click'});
  return {ok: true};
}

// One page the extension sent: through a file (a page can be megabytes), read by the engine. Counts in the log, never the page.
const MAX_HTML = 3_000_000;
export async function read(storage, page, runEngine = pipeline.run) {
  heardFrom(page?.ticket);
  if (!/^https?:\/\//.test(String(page?.url || ''))) return {ok: false, error: 'no page address'};
  const file = path.join(os.tmpdir(), `jp-visit-${process.pid}-${Date.now()}.json`);
  const body = {url: String(page.url), title: String(page.title || '').slice(0, 300), session: String(page.session || '').slice(0, 64), site: siteNames.get(String(page?.ticket || '')) || '',
    html: String(page.html || '').slice(0, MAX_HTML), cards: Array.isArray(page.cards) ? page.cards.slice(0, 500) : [], known_list: !!page.knownList, place: String(page.place || '').slice(0, 80)};
  fs.writeFileSync(file, JSON.stringify(body));
  try {
    // Saving a page can ask Claude too (a list whose links do not look like jobs: src/sources/careers.py _asked): that time is not silence
    // (owner's run, 7 Oct 2026: Tag Heuer and Hublot were skipped as silent while it answered).
    const {code, stdout} = await whileThinking(String(page?.ticket || ''), runEngine(storage, ['src.desktop', 'visit-read', file], onLine));
    const answer = (() => { try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return null; } })();
    if (code !== 0 || !answer?.ok) {
      log('visit', 'page not read', {host: new URL(body.url).hostname, code});
      return {ok: false, error: 'The app could not read this page.'};
    }
    log('visit', 'read a page the user opened', {host: new URL(body.url).hostname, name: answer.name, jobs: answer.jobs, added: answer.added, fits: answer.fits ?? null, cards: body.cards.length, session: body.session});
    if (page?.ticket) fitsBy.set(String(page.ticket), answer.fits || 0);   // the site's latest count (pages of one visit add up in the engine)
    watchers.get(page?.ticket)?.({page: answer, url: body.url});
    return answer;
  } finally {
    fs.rmSync(file, {force: true});
  }
}

// "Find jobs using your browser" (Actions, owner 7 Oct 2026): open the chosen sites in the browser with the extension, `atOnce` at a time,
// each marked so the extension filters (if asked) and reads it by itself (extension/visit.js autoRead); each reports back (done) and closes,
// then the next opens. A site that does not report within WAIT_MS counts as stopped.
export const WAIT_MS = 8 * 60 * 1000;
export const BOARD_WAIT_MS = 30 * 60 * 1000;   // a held board waits for the person to sign in and press Read
// "Read this board": the address as a site of one, named by its host; null when it is not an https address.
export function boardSite(address) {
  try {
    const url = new URL(String(address || '').trim());
    return url.protocol === 'https:' && !url.username && !url.password ? {name: url.hostname.replace(/^www\./, ''), url: url.href.split('#')[0], kind: 'board'} : null;
  } catch { return null; }
}
export const QUIET_MS = 30 * 1000;   // a site that sends no news (no page read, no wait) for this long is skipped, said in plain words
// One minute per site (owner, 7 Oct 2026): the extension stops its own read then (extension/visit.js SITE_MS); this is the app's cap
// for an extension that hangs, a little later so its own stop arrives first. Waiting on the person (the one-time Allow) is not counted.
export const SITE_MS = 75 * 1000;
let fitsLast = 0;
export const lastFits = () => fitsLast;   // the last task's jobs that fit the search: main.js starts a search to score them
const siteNames = new Map();   // ticket -> the site's name in the list ("Chanel"), for a job system found while reading it
const fitsBy = new Map();   // ticket -> jobs of that site's visit that fit the search (role words and places), for the task's result
const lastNews = new Map();   // ticket -> time of the extension's last report for that tab
export function heardFrom(ticket) { if (ticket && lastNews.has(ticket)) lastNews.set(ticket, Date.now()); }
const waiting = new Map();   // start address -> resolve
const watchers = new Map();   // ticket -> the running site's listener: a page read, a wait on the person
// One site's state as one plain line of the task's log (indented: never the banner's step). The run's step card draws a row per site from these
// lines, live and afterwards (renderer/visit-rows.js parseSiteRows): `  ▸ <state> · <site> · <words>`.
export const SITE_STATES = ['next', 'opening', 'waiting', 'reading', 'done', 'stopped', 'closed'];
const plain = text => String(text || '').replace(/\s*·\s*/g, ', ').replace(/\n/g, ' ').trim();
export const siteLine = (state, name, words) => `  ▸ ${state} · ${plain(name)} · ${plain(words)}`;
// Which Chrome tab reads which site: the extension's tab report (on every open, change and close, and every 30 s), bound the way Applying binds
// a form to its tab (review.js noteTabs). A site whose tab is gone from a report was closed by you: said at once, and the next site opens.
const tabOf = new Map();   // ticket -> tab id
const marks = new Map();   // ticket -> the mark its tab was opened with (jp-read or jp-read-filter), to hand it back after a restart
let bootId = '';
// Returns the tabs to hand back to the extension: [{tab, ticket, mark}] (server.js answers them as `reread`, extension/background.js reads them again).
let workerId = '';
export function noteTabs({ids, boot, worker, reading} = {}) {
  const resume = [];
  const renumbered = boot && boot !== bootId, restarted = renumbered || (worker && worker !== workerId);
  if (restarted) {
    // The extension started again (reloaded, updated, or its worker stopped by Chrome) while sites were read: each reading lived in its memory
    // and died with it, and the app then waited 30 s per site for nothing (owner's run, 7 Oct 2026 23:47: a reload 7 s in, 3 of 5 sites
    // "stopped answering"). A tab still open is handed back, to be read again from where it is. After a Chrome restart the tabs were numbered
    // again, so a tab id is trusted only when it is still open.
    const open = new Set((Array.isArray(ids) ? ids : []).map(Number));
    if (bootId || workerId) log('visit', 'the extension started again', {why: renumbered ? 'new browser run' : 'new worker', readTabs: tabOf.size});
    if (bootId || workerId) for (const [ticket, tab] of tabOf) if (watchers.has(ticket) && marks.has(ticket) && open.has(tab)) resume.push({tab, ticket, mark: marks.get(ticket)});
    if (boot) bootId = String(boot);
    if (worker) workerId = String(worker);
    if (renumbered) tabOf.clear();
    for (const {tab, ticket} of resume) {
      tabOf.set(ticket, tab);
      log('visit', 'read handed back after the extension restarted', {ticket, tab, site: siteNames.get(ticket) || '', why: renumbered ? 'extension reloaded' : 'extension worker restarted'});
      stepOf({ticket, words: 'the extension restarted in Chrome: reading this tab again'});
    }
  }
  if (!Array.isArray(ids) || !reading || typeof reading !== 'object') return resume;   // an older extension: its report has no read tabs
  const open = new Set(ids.map(Number).filter(Number.isInteger));
  for (const [ticket, tab] of Object.entries(reading)) {
    if (!watchers.has(ticket) || !Number.isInteger(Number(tab))) continue;
    if (tabOf.get(ticket) !== Number(tab)) log('visit', 'read tab reported', {ticket, tab: Number(tab)});   // its id: which tab Open in Chrome shows
    tabOf.set(ticket, Number(tab));
  }
  for (const [ticket, tab] of [...tabOf]) {
    if (!watchers.has(ticket)) tabOf.delete(ticket);
    else if (!open.has(tab)) { tabOf.delete(ticket); watchers.get(ticket)({closed: true}); }
  }
  return resume;
}
// The run going on now (one at a time: pipeline.work joins a second click): its queue, so "Open again" puts a closed site back in it, and where each
// site's tab is (the last page it read), for "Show tab".
let active = null;   // {queue, sites, lastPage: Map(start address -> page address), back(site)}
export function again(url) {
  const site = active?.sites.find(item => key(item.url) === key(url));
  if (!site) return {ok: false, error: 'This run has ended: start Find jobs using your browser again for it.'};
  active.back(site);
  log('visit', 'site opened again', {host: new URL(site.url).hostname, decidedBy: 'user click'});
  return {ok: true};
}
// "Open it myself" / "Open in Chrome" and every other button that opens a site for you (main.js openVisit): the tab you already have for it,
// brought forward, else a new one (owner, 8 Oct 2026: it opened another tab rather than the open one). Its reading tab by id while a run
// reads it, else a tab at the last page read there or at its address.
const seenPages = new Map();   // start address -> the last page read there; kept after the run, for this
export async function openYourself(url, {focusById = focusTabById, focusAt = focusTabAt, opener = open} = {}) {
  const tab = tabOf.get(active?.tickets.get(key(url)));
  const pages = [...new Set([active?.lastPage.get(key(url)), seenPages.get(key(url)), key(url)].filter(Boolean))];
  let how = tab != null && await focusById(tab) ? 'tab id' : '';
  for (const page of pages) if (!how && await focusAt(page)) how = 'address';
  if (!how) return opener(url);
  log('visit', 'brought forward the tab you have for a site', {host: new URL(key(url)).hostname, how, decidedBy: 'user click'});
  return {ok: true, focused: true};
}
export async function showTab(url, {focusById = focusTabById, focusAt = focusTabAt, bringForward = focusBrowser} = {}) {
  const tab = tabOf.get(active?.tickets.get(key(url)));   // the id the extension reported for this site's tab (lib/form-tab.js focusTabById)
  const page = active?.lastPage.get(key(url)) || key(url);
  const how = (tab != null && await focusById(tab)) ? 'tab id' : (await focusAt(page)) ? 'address' : 'browser only';
  if (how === 'browser only') bringForward();
  log('visit', 'showed a reading tab', {host: new URL(page).hostname, how, tab: tab ?? null, decidedBy: 'user click'});
  return {ok: true, found: how !== 'browser only'};
}
export const percent = (done, total) => (total ? Math.round(done / total * 100) : 0);
const blocked = new Set();
// "Read this board": a tab opened for the person's own read (#jp-board): held, with no clock, until the extension has news (they pressed Read).
const held = new Map();   // ticket -> starts that site's minute now (its clock stays off while the ticket is in `blocked`)
const HELD_LINE = '⏳ Waiting for you in Chrome: ';   // the banner's step (renderer/pages/runs-page.js shows its Go to Chrome button on it)
const HELD_WORDS = {press: 'sign in to the board in its tab if it asks, then press Read in the Jobadabra extension',
  login: 'sign in to the board in its tab, then press Read in the Jobadabra extension', check: 'answer the check in the board\'s tab, then press Read in the Jobadabra extension'};
let waitingNotice = null;   // main.js: a notification whose click brings Chrome forward
export function onWaiting(fn) { waitingNotice = fn; }   // start addresses waiting on the person (the one-time Allow in Chrome)
// The extension waits on the person for a site: said in the task's log and as its running step (the banner), not "Reading …".
export function waitingFor(payload) {
  const url = which(payload);
  if (!waiting.has(url)) return {ok: true};
  if (['login', 'check'].includes(payload?.why) && marks.get(url) === 'jp-board') {   // a board asked for a sign-in or a check: the person does it in that tab, then presses Read again
    blocked.add(url);
    const words = payload.why === 'login' ? HELD_WORDS.login : HELD_WORDS.check;
    watchers.get(url)?.({waiting: words});
    taskTee?.(`${HELD_LINE}${words}`);
    return {ok: true};
  }
  if (blocked.has(url)) return {ok: true};
  blocked.add(url);
  watchers.get(url)?.({waiting: true});
  waitingNotice?.();
  onLine('⏳ Waiting for you in Chrome: press "Allow on the sites the app opens" on the Jobadabra page it opened (once)');
  log('visit', 'waiting for the person in Chrome', {host: new URL(url).hostname, why: String(payload?.why || '').slice(0, 20)});
  return {ok: true};
}
const key = url => String(url || '').split('#')[0].replace(/\/$/, '');
// The tab's ticket (in its mark) first: a site that redirected reports another address. Its start address otherwise (an older extension).
const which = payload => (payload?.ticket && waiting.has(payload.ticket) ? payload.ticket : key(payload?.url));
// What a tab is doing now, in the extension's own words (extension/visit.js tellStep: the same as its banner on the page): the site's row says it,
// and it counts as news, so a site whose Claude is still choosing filters is not skipped as silent.
const lastStep = new Map();   // ticket -> the tab's last step, named when a site is skipped ("stopped while Claude was learning…")
// Claude's time for a tab (choosing filters, learning the page, finding the job list): not silence, and not counted against the site's minute
// (owner's run, 7 Oct 2026: Hublot, Omega and Baume & Mercier were skipped as silent while Claude was answering).
const thinking = new Map(), thoughtMs = new Map();
export async function whileThinking(ticket, work) {
  if (!ticket) return work;
  const began = Date.now();
  thinking.set(ticket, (thinking.get(ticket) || 0) + 1);
  const beat = setInterval(() => heardFrom(ticket), 5000);
  try { return await work; } finally {
    clearInterval(beat);
    thinking.set(ticket, thinking.get(ticket) - 1);
    if (!thinking.get(ticket)) thinking.delete(ticket);
    thoughtMs.set(ticket, (thoughtMs.get(ticket) || 0) + Date.now() - began);
    heardFrom(ticket);
  }
}
export function stepOf(payload) {
  const ticket = String(payload?.ticket || ''), words = String(payload?.words || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!ticket || !words) return {ok: true};
  heardFrom(ticket);
  if (held.has(ticket) && blocked.has(ticket)) { held.get(ticket)(); blocked.delete(ticket); }   // the person pressed Read: the extension has news, the site's minute starts
  lastStep.set(ticket, words);
  watchers.get(ticket)?.({step: words});
  return {ok: true};
}
export function done(payload) {
  const resolve = waiting.get(which(payload));
  if (resolve) { waiting.delete(which(payload)); resolve(payload); }
  return {ok: true};
}
// `prepare` (a site -> the site to open, e.g. with its job page found): run in the site's own lane just before its tab opens, so the first tab
// opens after one lookup, not after all of them (7 Oct 2026: "Finding the job page of 7 employers…" held every tab for about 2 minutes).
// signal: Stop (lib/pipeline.js work): no further site opens, and the ones reading now end at once (their tabs are left as they are).
export async function runAll(sites, {hold = false, atOnce = 2, filter = true, tee = () => {}, openTab = open, waitMs = WAIT_MS, quietMs = QUIET_MS, siteMs = SITE_MS, prepare = null, signal = null} = {}) {
  const queue = [...sites], results = [];
  const mine = new Set();   // this run's tickets still waiting, for Stop
  signal?.addEventListener('abort', () => {
    queue.length = 0;
    for (const ticket of mine) { const resolve = waiting.get(ticket); waiting.delete(ticket); resolve?.({stopped: 'Stopped by you', jobs: 0, added: 0}); }
  }, {once: true});
  taskTee = tee;
  let doneCount = 0;
  for (const site of sites) tee(siteLine('next', site.name, key(site.url)));
  const one = async chosen => {
    let site = chosen;
    if (prepare) {
      tee(siteLine('opening', chosen.name, 'Finding its job page…'));
      site = {...chosen, ...(await prepare(chosen).catch(() => chosen))};
    }
    const ticket = crypto.randomBytes(4).toString('hex');   // in the tab's mark, reported back: matched even after a redirect
    siteNames.set(ticket, site.name);
    active?.tickets.set(key(site.url), ticket);
    lastNews.set(ticket, Date.now());
    let openedAt = Date.now();   // a held board: from the person's Read (release below)
    let waitTimer = null;   // the wait for the first news; the person's Read is that news
    if (signal?.aborted) return {...site, start: chosen.url, ok: false, why: 'Stopped by you', jobs: 0, added: 0};
    mine.add(ticket);
    if (hold) { held.set(ticket, () => { openedAt = Date.now(); clearTimeout(waitTimer); }); blocked.add(ticket); }   // "Read this board": waits for the person's Read, no clock runs
    const finished = new Promise(resolve => {
      waiting.set(ticket, resolve);
      const watch = setInterval(() => {   // silent too long and not waiting on the person: skipped, with words that say so
        if (!waiting.has(ticket)) { clearInterval(watch); return; }
        const stuck = lastStep.get(ticket) ? ` (last step: ${lastStep.get(ticket).replace(/…$/, '')})`
          : (lastNews.get(ticket) || 0) > openedAt ? '' : ' (it never started reading: is the extension on in Chrome?)';
        if (thinking.has(ticket)) return;   // Claude is answering for this tab: not silence, and its time is not counted
        if (!blocked.has(ticket) && Date.now() - openedAt - (thoughtMs.get(ticket) || 0) > siteMs) {
          clearInterval(watch);
          waiting.delete(ticket);
          resolve({stopped: `${Math.round(siteMs / 1000)} s are up${stuck}: skipped, the jobs read so far are kept`, jobs: 0, added: 0, quiet: true});
          return;
        }
        if (!blocked.has(ticket) && Date.now() - (lastNews.get(ticket) || 0) > quietMs) {
          clearInterval(watch);
          waiting.delete(ticket);
          resolve({stopped: `it stopped answering (nothing for ${Math.round(quietMs / 1000)} s)${stuck}: skipped, you can close its tab`, jobs: 0, added: 0, quiet: true});
        }
      }, Math.min(5000, quietMs, siteMs));
      waitTimer = setTimeout(() => {
        if (!waiting.delete(ticket)) return;
        resolve({stopped: blocked.has(ticket) ? 'you have not allowed the extension on the sites the app opens yet (Chrome, the Jobadabra page)'
          : 'no answer from the extension in time: is it installed and enabled in Chrome?', jobs: 0, added: 0});
      }, waitMs);
    });
    let pages = 0, jobs = 0;
    watchers.set(ticket, event => {
      if (event.closed) {
        const resolve = waiting.get(ticket);
        waiting.delete(ticket);
        log('visit', 'read tab closed by the person', {host: new URL(site.url).hostname, pages});
        resolve?.({stopped: 'You closed the tab', closed: true, jobs: 0, added: 0});
      }
      if (event.step) tee(siteLine('reading', site.name, `${event.step}${jobs ? ` · ${jobs} jobs so far` : ''}`));
      if (event.waiting) tee(siteLine('waiting', site.name, typeof event.waiting === 'string' ? event.waiting : 'Waiting for you in Chrome: press Allow on the Jobadabra page'));
      if (event.page) { active?.lastPage.set(key(chosen.url), event.url); seenPages.set(key(chosen.url), event.url); blocked.delete(ticket); pages += 1; jobs = Math.max(jobs, Number(event.page.jobs) || 0); tee(siteLine('reading', site.name, `page ${pages} · ${jobs} jobs`)); }
    });
    const mark = hold ? 'jp-board' : filter ? 'jp-read-filter' : 'jp-read';
    marks.set(ticket, mark);
    const opened = openTab(`${key(site.url)}#${mark}-${ticket}`);
    if (!opened.ok) {
      waiting.delete(ticket); watchers.delete(ticket); blocked.delete(ticket); held.delete(ticket);
      doneCount += 1;
      tee(siteLine('stopped', site.name, opened.error));
      return {...site, start: chosen.url, ok: false, why: opened.error, jobs: 0, added: 0};
    }
    tee(siteLine('opening', site.name, 'Opening in Chrome…'));
    if (hold) { tee(siteLine('waiting', site.name, HELD_WORDS.press)); tee(`${HELD_LINE}${HELD_WORDS.press}`); }
    if (!hold) tee(`⏳ Finding jobs in your browser: ${doneCount} of ${sites.length} done · ${percent(doneCount, sites.length)}% · now ${site.name}`);   // the banner's step while it reads (a held board's step says what waits on the person)
    const state = await finished;
    mine.delete(ticket);
    watchers.delete(ticket);
    blocked.delete(ticket); held.delete(ticket);
    lastNews.delete(ticket);
    lastStep.delete(ticket); thoughtMs.delete(ticket);
    marks.delete(ticket);
    const fits = fitsBy.get(ticket) || 0;
    fitsBy.delete(ticket);
    if (state.quiet) tee(`⏳ ${site.name} is not responding: skipped, the next site opens`);
    const ok = (state.jobs || 0) > 0 || !!state.empty;   // a list with none in your places today was read, not failed (extension/visit.js)
    // A site read in part says why it stopped (7 Oct 2026: Chanel and Van Cleef read 220 jobs each and stopped at the minute, which no line said).
    const cut = ok && cutShort(state.stopped) ? `; ${state.stopped}` : '';
    tee(`${ok ? '  ✓' : '  ✗'} ${site.name}: ${ok ? `${state.jobs} job${state.jobs === 1 ? '' : 's'} (${state.added || 0} new), ${fits} matching your search${cut}` : state.stopped || 'nothing read'}`);
    doneCount += 1;
    tee(siteLine(ok ? 'done' : state.closed ? 'closed' : 'stopped', site.name, ok ? `${state.jobs} job${state.jobs === 1 ? '' : 's'} read (${state.added || 0} new), ${fits} matching your search${cut}` : state.stopped || 'nothing read'));
    tee(`⏳ Finding jobs in your browser: ${doneCount} of ${sites.length} · ${percent(doneCount, sites.length)}% · ${site.name}: ${ok ? `${state.jobs} jobs` : 'stopped'}`);   // the window's running step
    log('visit', 'site read by the Actions task', {host: new URL(site.url).hostname, jobs: state.jobs || 0, added: state.added || 0, fits, pages: state.pages || 0, stopped: String(state.stopped || '').slice(0, 80)});
    return {...site, start: chosen.url, ok, why: state.stopped || '', jobs: state.jobs || 0, added: state.added || 0, fits};
  };
  active = {queue, sites, lastPage: new Map(), tickets: new Map(), back: site => {   // "Open again": the site is next once more, and no longer counted as finished
    if (queue.includes(site)) return;
    queue.push(site);
    doneCount = Math.max(0, doneCount - 1);
    tee(siteLine('next', site.name, key(site.url)));
  }};
  const lanes = Array.from({length: Math.max(1, Math.min(5, atOnce))}, async () => {
    while (queue.length) results.push(await one(queue.shift()));
  });
  await Promise.all(lanes).finally(() => { taskTee = null; active = null; });
  const last = sites.map(site => results.findLast(result => (result.start || result.url) === site.url)   // a site opened again: its last reading
    || {...site, start: site.url, ok: false, why: 'Stopped by you', jobs: 0, added: 0});   // never opened: the run was stopped first
  fitsLast = last.reduce((sum, result) => sum + (result?.ok ? result.fits || 0 : 0), 0);
  return last;
}
export {cutShort, resultMessage};   // lib/visit-result.js

// "Jobs we couldn't read" (8 Oct 2026): open jobs in your places whose posting only a browser can read (a sign-in site, a site that refused this
// Mac, a page drawn by scripts). The extension opens each posting (mark #jp-posting-<ticket>), reads its text and sends it to /extension/posting;
// the engine keeps it for that job (src/sources/describe.py save_text), so the light run scores it. One at a time: each is one page.
export const POSTING_MS = 45000;
export async function stuckJobs(storage, runEngine = pipeline.run) {
  const {stdout} = await runEngine(storage, ['src.desktop', 'stuck-jobs']).catch(() => ({stdout: ''}));
  try { return JSON.parse(String(stdout).trim().split('\n').pop()).jobs || []; } catch { return []; }
}
// The extension's reading of one posting: {ticket, url, title, text, blocked: 'login'|'check'|''}. Answers {ok, saved}.
export async function posting(storage, payload, runEngine = pipeline.run) {
  const ticket = String(payload?.ticket || ''), resolve = waiting.get(ticket);
  heardFrom(ticket);
  const blockedBy = ['login', 'check'].includes(payload?.blocked) ? payload.blocked : '';
  const text = String(payload?.text || '').slice(0, 20000);
  const answer = blockedBy || text.trim().length < 200 ? {ok: true, saved: false}
    : ((await engineJson(storage, 'set-description', {url: String(payload?.url || ''), text}, runEngine).catch(() => null)) || {ok: false, saved: false});
  log('visit', 'posting read in your browser', {host: (() => { try { return new URL(String(payload?.url)).hostname; } catch { return ''; } })(), chars: text.length,
    blocked: blockedBy, saved: !!answer.saved, waited: !!resolve});
  if (resolve) { waiting.delete(ticket); resolve({saved: !!answer.saved, blocked: blockedBy}); }
  return {ok: !!answer.ok, saved: !!answer.saved};
}
export async function readPostings(jobs, {tee = () => {}, openTab = open, waitMs = POSTING_MS, signal = null} = {}) {
  let saved = 0;
  for (const [at, job] of jobs.entries()) {
    if (signal?.aborted) break;
    const ticket = crypto.randomBytes(4).toString('hex');
    lastNews.set(ticket, Date.now());
    tee(`⏳ Reading the jobs we couldn't read: ${at} of ${jobs.length} · ${percent(at, jobs.length)}% · now ${job.title || key(job.url)}`);
    const state = await new Promise(resolve => {
      waiting.set(ticket, resolve);
      const opened = openTab(`${key(job.url)}#jp-posting-${ticket}`);
      if (!opened.ok) { waiting.delete(ticket); resolve({why: opened.error}); return; }
      const stop = () => { if (waiting.delete(ticket)) resolve({why: 'Stopped by you'}); };
      signal?.addEventListener('abort', stop, {once: true});
      setTimeout(() => { if (waiting.delete(ticket)) resolve({why: `no answer from the extension in ${Math.round(waitMs / 1000)} s`}); }, waitMs);
    });
    lastNews.delete(ticket);
    if (state.saved) saved += 1;
    const why = state.saved ? 'read' : state.blocked === 'login' ? 'needs you to sign in' : state.blocked === 'check' ? 'a bot check: open it yourself' : state.why || 'no posting text on the page';
    tee(`${state.saved ? '  ✓' : '  ✗'} ${job.title || 'Job'}${job.company ? ` at ${job.company}` : ''}: ${why}`);
  }
  log('visit', 'postings read in your browser', {jobs: jobs.length, saved, stopped: !!signal?.aborted});
  return saved;
}

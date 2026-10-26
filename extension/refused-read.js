// Refused sites read in the person's browser (owner, 19 Oct 2026; rule: CLAUDE.md, the exception to "never past a login wall"). Only after the person pressed
// "Find jobs using your browser" in the app (owner, 26 Oct 2026: "shouldn't start automatically in the background"): the one-minute look asks the app whether a
// press waits, and only then the app lists the sites that refused its own reading and are due (no timer, no start by itself). Each is fetched ONCE, one at a time, with a pause, WITHOUT cookies or logins (credentials omitted), and the page goes to the app, which keeps its jobs
// or the stop. Never LinkedIn, Indeed, Glassdoor, levels.fyi, Reddit (checked here too, whatever the app says); a refusal, bot check or login page is the app's stop, never retried and
// never solved; a site that still refuses goes on to a real tab in an incognito window (refused-tab.js, no cookies). Not a flow file: nothing here touches an application. Guard: desktop/test/extension-refused-read.test.js.
import {api, settings} from './flow.js';
import {ALL_SITES} from './site-allow.js';
import {tabReader} from './refused-tab.js';
import {show as showHeldCheck, look as lookAtHeldCheck} from './refused-held.js';

export const ALARM = 'refused-reads';   // the hourly timer of versions before 26 Oct 2026: cleared at start, never created
export const NOW_ALARM = 'refused-reads-now';   // every minute: has the person pressed the button? (one cheap call, the engine is not asked)
export const PAUSE_MS = [5000, 12000];   // between sites: gentle, one at a time
export const MAX_SITES = 12;             // the app's own cap, kept here too
export const MAX_BYTES = 3_000_000;
const NEVER = ['linkedin.', 'indeed.', 'glassdoor.', 'levels.fyi', 'reddit.', 'xing.'];   // login-wall sites: only through the person's own visit

export function mayFetch(url) {
  let parts;
  try { parts = new URL(url); } catch { return false; }
  return parts.protocol === 'https:' && !NEVER.some(word => `${parts.hostname.toLowerCase()}.`.includes(word));
}
const titleOf = html => (/<title[^>]*>([^<]{0,300})/i.exec(html) || [])[1]?.trim() || '';
const wait = ms => new Promise(done => setTimeout(done, ms));
let running = false;
const incognitoAllowed = chrome => new Promise(resolve => { try { chrome.extension.isAllowedIncognitoAccess(answer => resolve(!!answer)); } catch { resolve(true); } });   // unknown: no nagging

// One pass. Everything the browser does is injected so a test can run it without Chrome.
export async function pass({chrome = globalThis.chrome, call = api, config = null, fetchPage = fetch, tabs = null, pause = () => wait(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]))} = {}) {
  if (running) return {read: 0, skipped: 'running'};
  running = true;
  try {
    const cfg = config || await settings();
    const allowed = await chrome.permissions.contains(ALL_SITES);
    const asked = await call(cfg, '/extension/refused-queue', {method: 'POST', body: JSON.stringify({allowed, incognito: await incognitoAllowed(chrome)})}).catch(() => null);
    const sites = allowed && asked?.on ? (asked.sites || []).slice(0, MAX_SITES) : [];
    let read = 0;
    const judge = page => call(cfg, '/extension/refused-judge', {method: 'POST', body: JSON.stringify(page)});
    const tab = tabs || tabReader({chrome, judge});
    for (const [index, site] of sites.entries()) {
      if (index) await pause();
      if (!mayFetch(site.url)) { await call(cfg, '/extension/refused-outcome', {method: 'POST', body: JSON.stringify({url: site.url, status: 0, html: ''})}).catch(() => null); continue; }
      // The ladder (owner, 20 Oct 2026): the Chrome download, then a real tab; a site that last opened at the tab step starts there.
      let page = {url: site.url, status: 0, html: '', final: '', step: 'download'};
      if (site.step !== 'tab') {
        try {
          const response = await fetchPage(site.url, {credentials: 'omit', redirect: 'follow', cache: 'no-store'});
          const html = (await response.text()).slice(0, MAX_BYTES);
          page = {url: site.url, status: response.status, html, title: titleOf(html), final: response.url || site.url, step: 'download'};
        } catch (error) { page.status = 0; page.error = String(error?.message || error).slice(0, 100); }
      }
      const state = site.step === 'tab' ? 'refused' : page.status === 429 ? 'page' : (await judge(page).catch(() => null))?.state || 'refused';   // a 429 is "slow down", never a ladder step
      if (state !== 'page' && page.status !== 429) {
        const tabbed = await tab.read(site.url).catch(() => ({skipped: 'error'}));
        if (tabbed.page) page = {...tabbed.page, step: 'tab', ...(tabbed.state === 'captcha' ? {captcha: true} : {})};   // words-ok: the app AI's fixed page_state answer, not a page's words
        else if (tabbed.skipped === 'incognito') page = {...page, tabSkipped: 'incognito'};   // the app tells the person about the one Chrome switch
      }
      const reported = await call(cfg, '/extension/refused-outcome', {method: 'POST', body: JSON.stringify(page)}).catch(() => null);
      read++;
      if (reported?.stop) break;   // the person pressed Stop in the app: no further site
    }
    await tab.close().catch(() => {});
    if (sites.length) await call(cfg, '/extension/refused-done', {method: 'POST', body: '{}'}).catch(() => null);
    return {read};
  } finally { running = false; }
}

// The person pressed "Find jobs using your browser": the app says a press waits; the pass then reads the due sites at once.
export async function readNowIfAsked({chrome = globalThis.chrome, call = api, config = null} = {}) {
  if (running) return {read: 0, skipped: 'running'};
  const cfg = config || await settings();
  const asked = await call(cfg, '/extension/refused-pending', {method: 'POST', body: '{}'}).catch(() => null);
  if (asked?.openDetails) await chrome.tabs.create({url: `chrome://extensions/?id=${chrome.runtime.id}`}).catch(() => {});   // the person pressed "Open Chrome's switch" in the app (the extension may open its own details page)
  if (asked?.showCheck) await showHeldCheck(chrome).catch(() => {});   // the person pressed "Show the check": the one deliberate focus of the hidden window
  const solved = await lookAtHeldCheck({chrome, judge: page => call(cfg, '/extension/refused-judge', {method: 'POST', body: JSON.stringify(page)})}).catch(() => null);
  if (solved) await call(cfg, '/extension/refused-outcome', {method: 'POST', body: JSON.stringify({...solved, step: 'tab'})}).catch(() => null);   // solved by the person, then read like any page
  return asked?.pending ? pass({chrome, call, config: cfg}) : {read: 0};
}

export function startRefusedReads({chrome = globalThis.chrome} = {}) {
  chrome.alarms.clear(ALARM)?.catch?.(() => {});   // an older version's hourly read: gone (the app hands out nothing without a press anyway)
  chrome.alarms.create(NOW_ALARM, {delayInMinutes: 1, periodInMinutes: 1});
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === NOW_ALARM) readNowIfAsked({chrome}).catch(() => {});
  });
}

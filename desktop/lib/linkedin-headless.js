// LinkedIn jobs on every Find jobs, PR 2/3 (owner, 31 Oct 2026: "Every Find jobs, if the user is logged in via Linkedin Jobs, should search and scrape jobs, using the
// user's login" … "but headlessly"; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md). The step: the person's LinkedIn session (copied from their Chrome by the
// extension, kept in the Keychain: lib/linkedin-session.js) goes into the app's OWN hidden browser for the read and leaves it again on every way out; up to 3 searches, 3 pages each,
// one after another, read by the owned browser's extension exactly as in Chrome (extension/visit.js). It never solves a check, types a password or changes the browser's identity;
// a sign-in page, a check or a 401/403/429/999 ends it with no retry (a 429 also pauses LinkedIn for a day). Guard: test/linkedin-headless.test.js.
// Invariant: the session value is only ever in the `Storage.setCookies` call; not in a line, a result, an error or a log.
import * as realSession from './linkedin-session.js';
import {openCdpSession} from './cdp-session.js';

export const SEARCHES = 3, PAGES = 3;
const LIMITED = new Set([401, 403, 429, 999]);   // 999 is the status LinkedIn answers automated reads with
const DAY_MS = 24 * 3600 * 1000;
const WORDS = {
  'no-session': 'LinkedIn: sign in to LinkedIn in Chrome, then press Find jobs',
  'no-browser': 'LinkedIn: download Jobadabra\'s browser (one time) to read LinkedIn in the background',
  'signed-out': 'LinkedIn: sign in again in Chrome, then press Find jobs',
  check: 'LinkedIn asked for a check: not answered, nothing more is read this time',
  limited: 'LinkedIn asked us to slow down: left alone for now',
  failed: 'LinkedIn: could not be read this time',
  stopped: 'LinkedIn: stopped',
};
const jar = (cookies, now, clear) => cookies.map(([name, value]) => ({name, value: clear ? '' : value, domain: '.linkedin.com', path: '/', secure: true, httpOnly: name === 'li_at', sameSite: 'None',
  ...(clear ? {expires: Math.floor(now / 1000) - 3600} : {})}));
const onLinkedin = domain => /(^|\.)linkedin\.com$/.test(String(domain).replace(/^\./, ''));
// Why (31 Oct 2026, Gitar on #2699): LinkedIn rotates li_at and sets its own cookies (JSESSIONID on the www host, trackers) during the read; expiring only the two that were set would leave those
// in the profile. So the clean-up expires every LinkedIn cookie the browser actually holds, each with its own domain and path (never another site's), and the two that were set as the floor.
async function clearJar(browser, cookies, now) {
  const held = await browser.send('Storage.getCookies', {}).then(answer => answer?.cookies || []).catch(() => []);
  const gone = new Map();
  for (const c of [...jar(cookies, now, true), ...held.filter(c => onLinkedin(c.domain)).map(c => ({name: c.name, value: '', domain: c.domain, path: c.path || '/', secure: c.secure !== false, expires: Math.floor(now / 1000) - 3600}))]) gone.set(`${c.name}@${c.domain}${c.path}`, c);
  await browser.send('Storage.setCookies', {cookies: [...gone.values()]});
}

// A tab opened blank, watched, then sent to the marked address: the extension reads it (extension/background.js #jp-read-<ticket>); the first main-document status is seen first.
function tabOpener({browser, openCdp, end, tabs, sessions, seen}) {
  return url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)?.[1], start = url.split('#')[0];
    const stop = why => end({url: start, ticket, jobs: 0, added: 0, pages: 0, stopped: why});
    const limited = ({type, response} = {}) => {
      if (type !== 'Document' || !LIMITED.has(response?.status) || seen.status || !/(^|\.)linkedin\.com$/.test(new URL(response.url).hostname)) return;
      seen.status = response.status;
      stop('LinkedIn asked us to slow down');
    };
    (async () => {
      const {targetId} = await browser.send('Target.createTarget', {url: 'about:blank'});
      tabs.push(targetId);
      const cdp = await openCdp(await browser.targetSocket(targetId));
      sessions.push(cdp);
      cdp.on('Network.responseReceived', limited);
      await cdp.send('Network.enable');
      await cdp.send('Page.navigate', {url});
    })().catch(() => stop('the background browser could not open the page'));
    return {ok: true};
  };
}

/** Why a read ends after one search, or null to go on: the 429-style status the tab saw, a sign-in page, a check page (the extension's page kind, not words), or Stop. */
export function endOf(result, seen, signal) {
  if (seen.status) return 'limited';
  if (result?.blocked === 'login') return 'signed-out';
  if (result?.blocked === 'check') return 'check';
  return signal?.aborted || result?.why === 'Stopped by you' ? 'stopped' : null;
}

// Every gate before anything is started; -> {state, jobs} to stop here, or {session} to go on.
function gate({storage, browser, signal, now, readSession}) {
  if (!realSession.state(storage).on) return {state: 'off', jobs: 0, quiet: true};
  if (signal?.aborted) return {state: 'stopped', jobs: 0};
  if (realSession.pausedUntil(storage) > now()) return {state: 'limited', jobs: 0};
  const session = readSession();
  if (!session?.li_at) return {state: 'no-session', jobs: 0};
  return browser.ready() ? {session} : {state: 'no-browser', jobs: 0};
}

async function readAll({list, run, openTab, signal, tee, pause, seen, closeTabs}) {
  const total = {jobs: 0, fits: 0, read: 0, verdict: 'done'};
  for (const [index, search] of list.entries()) {
    if (signal?.aborted) { total.verdict = 'stopped'; break; }
    if (index) await pause(3000 + Math.random() * 2000);   // a gap between searches, like a person: the extension also waits 2-3 s between pages
    tee(`LinkedIn: reading search ${index + 1} of ${list.length}`);
    const [result] = await run([{name: search.name, url: search.url}], {atOnce: 1, filter: false, maxPages: PAGES, openTab, signal,
      tee: line => { if (/^\s*[✓✗]/.test(line)) tee(line); }, waitMs: 40000, quietMs: 30000, siteMs: 75000});
    await closeTabs();
    total.jobs += result?.jobs || 0; total.fits += result?.fits || 0; total.read += 1;
    const ended = endOf(result, seen, signal);
    if (ended) { total.verdict = ended; break; }
  }
  return total;
}

/**
 * Read the person's LinkedIn searches in the owned browser. Every seam is injected (browser, CDP opener, runAll, `end` = visits.done, session reader, pause).
 * -> {state: 'off'|'no-session'|'no-browser'|'done'|'signed-out'|'check'|'limited'|'stopped'|'failed', jobs, read?, of?, pauseUntil?}; the caller records it (linkedin-session.js noteRun).
 */
export async function linkedinStep({storage, browser, openCdp = openCdpSession, run, end, tee = () => {}, signal = null, now = Date.now, searches, readSession = realSession.readSession,
  port, token, pause = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const say = state => { if (WORDS[state]) tee(WORDS[state]); return {state, jobs: 0}; };
  const gated = gate({storage, browser, signal, now, readSession});
  if (!gated.session) return gated.quiet ? {state: 'off', jobs: 0} : say(gated.state);
  try { await browser.start({port, token: typeof token === 'function' ? token() : token}); } catch (error) { return say(error?.code === 'BACKGROUND_BROWSER_MISSING' ? 'no-browser' : 'failed'); }
  const list = (await searches().catch(() => [])).slice(0, SEARCHES);
  if (!list.length) { tee('LinkedIn: no search to read for your strategy'); return {state: 'done', jobs: 0, read: 0, of: 0}; }
  const cookies = Object.entries(gated.session), tabs = [], sessions = [], seen = {status: 0};
  const closeTabs = async () => { for (const id of tabs.splice(0)) await browser.send('Target.closeTarget', {targetId: id}).catch(() => {}); for (const cdp of sessions.splice(0)) await cdp.detach().catch(() => {}); };
  const openTab = tabOpener({browser, openCdp, end, tabs, sessions, seen});
  let total = {jobs: 0, fits: 0, read: 0, verdict: 'failed'};
  try {
    await browser.send('Storage.setCookies', {cookies: jar(cookies, now(), false)});
    total = await readAll({list, run, openTab, signal, tee, pause, seen, closeTabs});
  } catch { /* the verdict stays 'failed' */ } finally {
    await closeTabs();
    await clearJar(browser, cookies, now()).catch(() => { total.verdict = 'failed'; });   // the session leaves the browser, whatever ended the step
  }
  const {jobs, fits, read, verdict} = total;
  const out = {state: verdict, jobs, fits, read, of: list.length, ...(seen.status === 429 ? {pauseUntil: new Date(now() + DAY_MS).toISOString()} : {})};
  if (verdict === 'done') tee(jobs ? `LinkedIn: ${jobs} job${jobs === 1 ? '' : 's'} read` : 'LinkedIn: none new');
  else say(verdict);
  return out;
}

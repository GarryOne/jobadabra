// Ready to send's "Open in my browser" (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md, PR 5b; owner 18 Oct 2026: carry the cookies, the normal fill takes over):
// the hand-off the night's server gave for one job (page address, its browser storage, a snapshot of the filled fields) waits here until the
// extension, in the tab the app opened for that job, asks for it once. Only that page's own site's cookies leave this module: the night's browser
// also holds other sites' cookies. Pure apart from the pending map. Guard: test/ready-handoff.test.js.
import {formUrl} from './form-address.js';

const WAIT_MS = 10 * 60 * 1000;   // a hand-off nobody asked for in 10 minutes is dropped (the tab never opened)
const pending = new Map();        // key -> {handoff, keys, at}
// The night's own decisions for the page (owner, 18 Oct 2026: "It should be all cached, every read and filled, from the 1st millisecond"; sketch
// https://claude.ai/artifact/ABDhNT7fNFCD6PmEiSu2hd, option A): the page's role and the AI's answers, replayed for that page instead of judged again.
// Kept for the morning's visit (2 h), not taken once: the fill asks for them after the tab moved and loaded.
const NIGHT_MS = 2 * 60 * 60 * 1000;
const nights = new Map();          // key -> {role, answers, at}
const MAX_ANSWERS = 200;
const words = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Pure: what the hand-off's `night` may carry: a role word and answers with the question they were for (any other key is dropped).
export function nightOf(given) {
  const role = ['form', 'account', 'posting', 'other'].includes(given?.role) ? given.role : '';
  const answers = (Array.isArray(given?.answers) ? given.answers : []).filter(each => each?.field && each.answer && typeof each.answer === 'object' && each.answer.value !== '' && each.answer.value != null)
    .slice(0, MAX_ANSWERS).map(each => ({field: String(each.field).slice(0, 200), label: String(each.label || '').slice(0, 300), answer: each.answer}));
  return {role, answers};
}

// A page's identity for matching: its origin and path, no #mark, no query, no trailing slash.
export function pageKey(url) {
  try { const at = new URL(String(url || '')); return `${at.origin}${at.pathname.replace(/\/+$/, '')}`; } catch { return ''; }
}

// The site a cookie belongs to, as the last two labels of its host (enough for the hosts job forms live on: boards.greenhouse.io and
// job-boards.greenhouse.io share greenhouse.io). A cookie for another site never goes with this page.
const siteOf = host => String(host || '').replace(/^\./, '').toLowerCase().split('.').slice(-2).join('.');

// Playwright's storageState cookies -> what chrome.cookies.set takes, for this page's site only.
export function cookiesFor(pageUrl, cookies = []) {
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch { return []; }
  const site = siteOf(host);
  return cookies.filter(cookie => cookie?.name && siteOf(cookie.domain) === site).map(cookie => {
    const domain = String(cookie.domain || host);
    const set = {url: `${cookie.secure === false ? 'http' : 'https'}://${domain.replace(/^\./, '')}${cookie.path || '/'}`, name: String(cookie.name), value: String(cookie.value ?? ''),
      path: cookie.path || '/', secure: cookie.secure !== false, httpOnly: !!cookie.httpOnly};
    if (domain.startsWith('.')) set.domain = domain;   // a host-only cookie stays host-only
    if (['Strict', 'Lax', 'None'].includes(cookie.sameSite)) set.sameSite = {Strict: 'strict', Lax: 'lax', None: 'no_restriction'}[cookie.sameSite];
    if (Number(cookie.expires) > 0) set.expirationDate = Number(cookie.expires);
    return set;
  });
}

// What the extension gets: the page to load, its cookies, its own origin's storage, and the snapshot (never a password: the server never takes one).
export function forExtension(handoff) {
  const url = String(handoff?.url || '');
  let origin = '';
  try { origin = new URL(url).origin; } catch { return null; }
  const local = (handoff.storage?.origins || []).find(each => each.origin === origin)?.localStorage || [];
  return {url, cookies: cookiesFor(url, handoff.storage?.cookies), localStorage: Object.fromEntries(local.map(item => [item.name, item.value])),
    sessionStorage: handoff.sessionStorage || {}, snapshot: {fields: handoff.snapshot?.fields || [], files: handoff.snapshot?.files || []}, fromNight: true};   // the night's answers stay in the app (nightAnswers): the tab only knows the night filled it
}

// Kept under every address the tab may first show: the job's link, its form address and the page the night ended on.
export function keep(handoff, addresses, now = Date.now()) {
  const ready = forExtension(handoff);
  if (!ready) return false;
  const keys = [...new Set([...addresses, ready.url].map(pageKey).filter(Boolean))];
  const entry = {handoff: ready, keys, at: now};
  const night = nightOf(handoff.night);
  for (const key of keys) { pending.set(key, entry); nights.set(key, {...night, at: now}); }
  return true;
}

/** Keep a hand-off for one job: under its link and its form address, whichever the reopened tab shows first. Returns false when the hand-off has no page.
 * Why (2026-10-28, #2339): this module owns which addresses a tab may first show; a session reopens from the posting and never names the form address itself. */
export const keepForJob = (handoff, jobUrl, now = Date.now()) => keep(handoff, [jobUrl, formUrl(jobUrl)], now);

// The extension's ask for the tab at `url`: the hand-off once (then it is gone under every key), or null.
export function take(url, now = Date.now()) {
  const entry = pending.get(pageKey(url));
  if (!entry) return null;
  for (const key of entry.keys) pending.delete(key);
  return now - entry.at > WAIT_MS ? null : entry.handoff;
}

const nightFor = (url, now) => { const night = nights.get(pageKey(url)); return night && now - night.at <= NIGHT_MS ? night : null; };

// The page kind the night's fill went by, for the app's page-kind route: 'form' only (the night filled it as one), else '' and the normal ask runs.
export const nightKind = (url, now = Date.now()) => (nightFor(url, now)?.role === 'form' ? 'form' : '');
export function forgetNightKind(url) { const night = nights.get(pageKey(url)); if (night) night.role = ''; }   // the page said otherwise (fill-flow.js forgetKind): its answers stay

// The extension's questions on that page, answered from the night: a field by its id and question, else by its question alone when one night answer has it.
// -> null when the night holds nothing for this page; else {answers (under today's field ids), rest (the questions the night did not see: the normal AI asks them)}.
export function nightAnswers(url, fields, now = Date.now()) {
  const night = nightFor(url, now);
  if (!night?.answers.length) return null;
  const answers = [], rest = [];
  for (const field of fields || []) {
    const same = night.answers.find(each => each.field === field.field && words(each.label) === words(field.label));
    const byQuestion = night.answers.filter(each => words(each.label) && words(each.label) === words(field.label));
    const found = same || (byQuestion.length === 1 ? byQuestion[0] : null);
    if (found) answers.push({...found.answer, field: field.field}); else rest.push(field);
  }
  return {answers, rest};
}

export const clear = () => { pending.clear(); nights.clear(); };   // tests

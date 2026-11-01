// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026: "Opt-in, warned once"; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the switch, how often
// the person was asked, and the LinkedIn session the extension copied from their Chrome. The session is a credential: the Keychain only (lib/keychain.js, so a test or
// the twin writes its own file, never the owner's), never the settings file, a log, the store or an upload; it is deleted when the switch goes off.
// Settings: settings.linkedinJobs = {on, asked, declined} (not settings.linkedin: that is the profile import's, lib/linkedin-oauth.js). Guard: test/linkedin-session.test.js.
import * as realKeychain from './keychain.js';

export const SERVICE = 'job-pilotto.linkedin-jobs.session';
export const ACCOUNT = 'linkedin-jobs';
export const COOKIE_NAMES = ['li_at', 'JSESSIONID'];   // the only two LinkedIn cookies that carry the sign-in; nothing else is read, sent or kept
export const MAX_ASKS = 2;                             // owner, 31 Oct 2026: "for the first, or for the second time"
const VALUE = /^[\x21-\x7e]{1,2048}$/;                 // one printable token (JSESSIONID keeps its quotes)

const onLinkedin = domain => { const host = String(domain || '').replace(/^\./, '').toLowerCase(); return host === 'linkedin.com' || host.endsWith('.linkedin.com'); };

/** The switch and the ask counters, always the same three keys. */
export function state(storage) {
  const mine = storage.settings().linkedinJobs || {};
  return {on: mine.on === true, asked: Math.min(MAX_ASKS, Number(mine.asked) || 0), declined: Math.min(MAX_ASKS, Number(mine.declined) || 0)};
}
// Why (31 Oct 2026, LinkedIn jobs 2/3): the object also holds the last run and a pause; a write of the switch or a counter must keep them.
const save = (storage, patch) => storage.saveSettings({linkedinJobs: {...(storage.settings().linkedinJobs || {}), ...state(storage), ...patch}});

/** Reduce what the extension sent to {li_at, JSESSIONID?}, or null. Invariant: only the allow-listed names of linkedin.com with a plain token value pass; li_at is required. */
export function cleanCookies(list) {
  if (!Array.isArray(list)) return null;
  const kept = {};
  for (const item of list) {
    if (!item || !COOKIE_NAMES.includes(item.name) || !onLinkedin(item.domain) || typeof item.value !== 'string' || !VALUE.test(item.value)) continue;
    kept[item.name] ??= item.value;
  }
  return kept.li_at ? Object.fromEntries(COOKIE_NAMES.filter(name => kept[name]).map(name => [name, kept[name]])) : null;
}

/** Store the copied session in the Keychain and turn the switch on. -> {ok: true} | {ok: false, error}; the value is never in the answer. */
export function saveSession(storage, cookies, {keychain = realKeychain} = {}) {
  const clean = cleanCookies(cookies);
  if (!clean) return {ok: false, error: 'No LinkedIn sign-in found in Chrome. Sign in to LinkedIn there, then try again.'};
  if (!keychain.write(SERVICE, JSON.stringify(clean), {account: ACCOUNT, label: 'Jobadabra: LinkedIn session'})) return {ok: false, error: 'The Keychain would not keep the LinkedIn sign-in, so LinkedIn jobs stays off.'};
  save(storage, {on: true});
  return {ok: true};
}

/**
 * The extension's fresh copy at a Find jobs press (issue #2731). Only while the switch is on (a copy never arrives with it off). Cookies that pass: replace the Keychain item.
 * No usable li_at (the person signed out in Chrome): the copy is deleted, because it mirrors Chrome ("deleted ... on sign-out", spec Safety) and the step then says no-session.
 * `held` false (the extension no longer holds the LinkedIn grants, so it read nothing): the Keychain is left as it is. -> {ok, kept?}; the value is never in the answer.
 */
export function refreshSession(storage, cookies, {keychain = realKeychain, held = true} = {}) {
  if (!state(storage).on) return {ok: false, error: 'LinkedIn jobs is off'};
  if (!held) return {ok: true, kept: true};
  const clean = cleanCookies(cookies);
  if (!clean) { keychain.remove(SERVICE, {account: ACCOUNT}); return {ok: true, signedOut: true}; }
  if (!keychain.write(SERVICE, JSON.stringify(clean), {account: ACCOUNT, label: 'Jobadabra: LinkedIn session'})) return {ok: false, error: 'The Keychain would not keep the LinkedIn sign-in'};
  return {ok: true};
}

/** The copied session, or null (the reader of PR 2). */
export function readSession({keychain = realKeychain} = {}) {
  try { const value = JSON.parse(keychain.read(SERVICE, {account: ACCOUNT}) || 'null'); return cleanCookies(COOKIE_NAMES.filter(name => value?.[name]).map(name => ({name, value: value[name], domain: '.linkedin.com'}))); } catch { return null; }
}

/** Switch off: the Keychain item goes, the ask counters stay. Repeatable. */
export function turnOff(storage, {keychain = realKeychain} = {}) {
  keychain.remove(SERVICE, {account: ACCOUNT});
  save(storage, {on: false, last: undefined, pauseUntil: undefined});   // a new yes starts clean: no old result, no old pause
  return {ok: true};
}

/** The one writer of a run's result (the step's verdict): {state, jobs, at} kept as `last`; a 429 also keeps `pauseUntil` (an ISO time). Never a cookie. */
export function noteRun(storage, {state: verdict, jobs = 0, at, pauseUntil}) {
  save(storage, {last: {state: String(verdict), jobs: Number(jobs) || 0, at: String(at)}, ...(pauseUntil ? {pauseUntil: String(pauseUntil)} : {})});
}
/** Epoch ms until which LinkedIn is left alone (a 429 asked us to slow down), or 0. */
export const pausedUntil = storage => Date.parse(storage.settings().linkedinJobs?.pauseUntil || '') || 0;

/** The ask on Find jobs: the 1st and 2nd press while off; never after On, two "Not now" or two asks. */
export const shouldAsk = mine => !mine.on && mine.asked < MAX_ASKS && mine.declined < MAX_ASKS;

/** The dialog was shown. Why (owner, 31 Oct 2026): the dialog's verdicts are the only writers of these counters, so "asked twice" cannot drift. */
export function noteAsked(storage) { const mine = state(storage); save(storage, {asked: Math.min(MAX_ASKS, mine.asked + 1)}); }
/** The person's answer to the ask: 'not-now' counts one decline (capped at 2), 'on' changes nothing (the session's arrival turns the switch on); any other word throws. */
export function noteAnswer(storage, answer) {
  if (answer === 'on') return;
  if (answer !== 'not-now') throw new Error(`unknown answer: ${answer}`);
  save(storage, {declined: Math.min(MAX_ASKS, state(storage).declined + 1)});
}

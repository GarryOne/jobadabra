// LinkedIn jobs on every Find jobs, PR 1/3 (owner, 31 Oct 2026: "Opt-in, warned once"; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the person's LinkedIn
// sign-in is copied to the app on this Mac so the app's own hidden browser can read their job searches. Chrome Web Store rules shape this file: the permissions are optional and
// asked only from linkedin.html on a click (consent shown there first); only li_at and JSESSIONID are read; they go only to the app's loopback address; the session is copied again only when the app says a Find jobs press wants it; and the permissions are
// given back when the app says the switch is off. Guard: desktop/test/extension-linkedin.test.js. Not a flow file: nothing here touches an application.
import {api, settings} from './flow.js';

export const LINKEDIN = {origins: ['https://www.linkedin.com/*'], permissions: ['cookies']};
export const NAMES = ['li_at', 'JSESSIONID'];   // the same list as desktop/lib/linkedin-session.js COOKIE_NAMES (the app re-checks)
export const ALARM = 'linkedin-session';
export const GRANTED = 'linkedinGranted';   // {cookies, origin}: which grants this consent added (storage.local), so only those are given back

/** The two sign-in cookies as {name, value, domain}; every other LinkedIn cookie stays in Chrome. */
export async function readCookies(chrome = globalThis.chrome) {
  const jar = await chrome.cookies.getAll({domain: 'linkedin.com'});
  return jar.filter(cookie => NAMES.includes(cookie.name)).map(({name, value, domain}) => ({name, value, domain}));
}

/** The consent page's click: ask Chrome (only now), read the two cookies, send them to the app. -> the app's answer, or {ok: false, why: 'denied' | 'signed-out'}.
 *  Why (Gitar on #2694): it first notes which of the two grants were NOT already there (the options page's "Open in my browser" toggle and "every site" already give `cookies` and the origin),
 *  so the revoke below gives back only what this consent added and never another feature's permission. */
export async function connect({chrome = globalThis.chrome, call = api, config = null} = {}) {
  const had = {cookies: await chrome.permissions.contains({permissions: LINKEDIN.permissions}).catch(() => false), origin: await chrome.permissions.contains({origins: LINKEDIN.origins}).catch(() => false)};
  if (!(await chrome.permissions.request(LINKEDIN).catch(() => false))) return {ok: false, why: 'denied'};
  // Why (1 Nov 2026, #2732): a grant this consent added earlier (a press while signed out of LinkedIn) is held now, so it reads as "already there"; it stays noted as ours until given back.
  const before = (await chrome.storage.local.get(GRANTED).catch(() => ({})))[GRANTED] || {};
  await chrome.storage.local.set({[GRANTED]: {cookies: !!before.cookies || !had.cookies, origin: !!before.origin || !had.origin}});
  const cookies = await readCookies(chrome);
  if (!cookies.some(cookie => cookie.name === 'li_at')) return {ok: false, why: 'signed-out'};
  return call(config || await settings(), '/extension/linkedin-session', {method: 'POST', body: JSON.stringify({cookies})});
}

/** A fresh copy for the Find jobs press that asked for one (issue #2731; spec Behaviour 1 "at each Find jobs while on"). Reads only when both LinkedIn grants are still held (never asks for them:
 *  a request needs the person's click), and posts only to the app. No li_at in Chrome = the person signed out: an empty list tells the app so. Grants gone = {held: false}: the app keeps what it has. */
export async function refreshSession({chrome = globalThis.chrome, call = api, config = null} = {}) {
  const held = await chrome.permissions.contains(LINKEDIN).catch(() => false);
  const body = held ? {cookies: await readCookies(chrome)} : {held: false};
  return call(config || await settings(), '/extension/linkedin-refresh', {method: 'POST', body: JSON.stringify(body)});
}

/** The one-minute look. Asks the app two things: is the switch off (give back what this consent added, nothing else), and does a Find jobs press want a fresh copy (refreshSession).
 *  Why (31 Oct 2026, Web Store): an app that does not answer takes nothing, so a closed app never revokes;
 *  Why (Gitar on #2694): a permission another feature already held (cookies from the options page, every site) is never removed here;
 *  Why (#2731): a consent that added nothing (both grants were already held) is still looked after for the refresh, so only the removal is skipped for it. */
export async function revokeIfOff({chrome = globalThis.chrome, call = api, config = null} = {}) {
  const granted = (await chrome.storage.local.get(GRANTED).catch(() => ({})))[GRANTED];
  if (!granted) return {held: false};
  const asked = await call(config || await settings(), '/extension/linkedin-pending', {method: 'POST', body: '{}'}).catch(() => null);
  if (asked?.revoke !== true) {
    if (asked?.refresh === true) await refreshSession({chrome, call, config}).catch(() => {});
    return {revoked: false};
  }
  const mine = {...(granted.cookies ? {permissions: LINKEDIN.permissions} : {}), ...(granted.origin ? {origins: LINKEDIN.origins} : {})};
  if (granted.cookies || granted.origin) await chrome.permissions.remove(mine).catch(() => {});
  await chrome.storage.local.remove(GRANTED).catch(() => {});
  return {revoked: true};
}

/** A grant Chrome reports removed (the options page's toggle, Chrome's own settings, our revoke) is no longer this consent's: its note field is cleared.
 *  Why (Gitar on #2845): the note survives a press while signed out (#2732), so without this a grant removed and then given again to another feature still read as ours, and an off took it. */
export async function forgetRemoved(removed, {chrome = globalThis.chrome} = {}) {
  const note = (await chrome.storage.local.get(GRANTED).catch(() => ({})))[GRANTED];
  if (!note) return;
  const gone = {cookies: (removed?.permissions || []).some(name => LINKEDIN.permissions.includes(name)), origin: (removed?.origins || []).some(origin => LINKEDIN.origins.includes(origin))};
  await chrome.storage.local.set({[GRANTED]: {cookies: !!note.cookies && !gone.cookies, origin: !!note.origin && !gone.origin}}).catch(() => {});
}

/** Start the one-minute look that gives the LinkedIn permissions back when the app says the switch is off, and the watch that keeps the grant note true; called once from background.js. */
export function startLinkedinSession({chrome = globalThis.chrome} = {}) {
  chrome.alarms.create(ALARM, {delayInMinutes: 1, periodInMinutes: 1});
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) revokeIfOff({chrome}).catch(() => {}); });
  chrome.permissions.onRemoved?.addListener(removed => forgetRemoved(removed, {chrome}).catch(() => {}));
}

// LinkedIn jobs on every Find jobs, PR 1/3 (owner, 31 Oct 2026: "Opt-in, warned once"; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the person's LinkedIn
// sign-in is copied to the app on this Mac so the app's own hidden browser can read their job searches. Chrome Web Store rules shape this file: the permissions are optional and
// asked only from linkedin.html on a click (consent shown there first); only li_at and JSESSIONID are read; they go only to the app's loopback address; and the permissions are
// given back when the app says the switch is off. Guard: desktop/test/extension-linkedin.test.js. Not a flow file: nothing here touches an application.
import {api, settings} from './flow.js';

export const LINKEDIN = {origins: ['https://www.linkedin.com/*'], permissions: ['cookies']};
export const NAMES = ['li_at', 'JSESSIONID'];   // the same list as desktop/lib/linkedin-session.js COOKIE_NAMES (the app re-checks)
export const ALARM = 'linkedin-session';

/** The two sign-in cookies as {name, value, domain}; every other LinkedIn cookie stays in Chrome. */
export async function readCookies(chrome = globalThis.chrome) {
  const jar = await chrome.cookies.getAll({domain: 'linkedin.com'});
  return jar.filter(cookie => NAMES.includes(cookie.name)).map(({name, value, domain}) => ({name, value, domain}));
}

/** The consent page's click: ask Chrome (only now), read the two cookies, send them to the app. -> the app's answer, or {ok: false, why: 'denied' | 'signed-out'}. */
export async function connect({chrome = globalThis.chrome, call = api, config = null} = {}) {
  if (!(await chrome.permissions.request(LINKEDIN).catch(() => false))) return {ok: false, why: 'denied'};
  const cookies = await readCookies(chrome);
  if (!cookies.some(cookie => cookie.name === 'li_at')) return {ok: false, why: 'signed-out'};
  return call(config || await settings(), '/extension/linkedin-session', {method: 'POST', body: JSON.stringify({cookies})});
}

/** Give the LinkedIn permissions back when the app says the switch is off. Why (31 Oct 2026, Web Store): an app that does not answer takes nothing, so a closed app never revokes. */
export async function revokeIfOff({chrome = globalThis.chrome, call = api, config = null} = {}) {
  if (!(await chrome.permissions.contains(LINKEDIN).catch(() => false))) return {held: false};
  const asked = await call(config || await settings(), '/extension/linkedin-pending', {method: 'POST', body: '{}'}).catch(() => null);
  if (asked?.revoke !== true) return {revoked: false};
  await chrome.permissions.remove(LINKEDIN).catch(() => {});
  return {revoked: true};
}

/** Start the one-minute look that gives the LinkedIn permissions back when the app says the switch is off; called once from background.js. */
export function startLinkedinSession({chrome = globalThis.chrome} = {}) {
  chrome.alarms.create(ALARM, {delayInMinutes: 1, periodInMinutes: 1});
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) revokeIfOff({chrome}).catch(() => {}); });
}

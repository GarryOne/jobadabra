// The Pro plan as the app sees it (private spec jobadabra-lab:docs/specs/2026-10-16-pro-plan.md §1, §4): asks the site who is Pro and how much AI credit is left, keeps the last
// answer (trusted for 14 days offline, then the app behaves as Free), and starts a one-time payment in the browser. The server is the source of truth; nothing here is a
// secret and no card data ever touches the app. Mode "off" (the site's PRO_PLAN flag, or a build that is not a regular install) means nothing about Pro is shown.
// Guards: test/plan.test.js.
import {installId} from './pool-share.js';
import {FREE_BASE} from './ai-free.js';
import {siteOffForUser} from './recipes.js';
import {forgetToken, installToken} from './install-token.js';

const SITE = FREE_BASE.replace(/\/api\/ai$/, '');
export const GRACE_DAYS = 14, REFRESH_MS = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
export const OFF = {mode: 'off', plan: 'free'};

// `stored`: demo mode (screenshots) shows the answer written in its settings and never asks the site.
export function createPlan(storage, {fetcher = globalThis.fetch, now = () => Date.now(), stored = false} = {}) {
  const off = () => siteOffForUser() && !stored;
  // This install's own token for the site (the one Free AI uses), whatever engine is chosen: an own-key user has no JPF1 key saved, so it is asked for here.
  async function siteKey() {
    const install = installId(storage);
    const token = await installToken(storage, install, 'ai', {base: SITE, fetcher});
    if (!token) throw new Error('no token');
    return `JPF1.${install}.${token}`;
  }
  const kept = () => storage.settings().plan || null;
  // The last answer, sync: Off without one; after 14 days without a fresh answer the person is Free again (never silently locked mid-work: only the credit lane stops).
  function state() {
    const last = kept();
    if (off() || !last?.status) return OFF;
    const age = now() - last.at;
    if (age > GRACE_DAYS * DAY) return {...OFF, mode: last.status.mode || 'off', stale: true};
    return {...last.status, at: last.at, stale: age > REFRESH_MS};
  }
  // Asks the site (a 404 means the plan is off there); on any failure the last answer stays. -> state()
  async function refresh() {
    if (siteOffForUser()) return stored ? state() : OFF;
    try {
      let response = await fetcher(`${SITE}/api/pro/status`, {headers: {'x-api-key': await siteKey()}});
      if (response.status === 401) { forgetToken(storage, 'ai'); response = await fetcher(`${SITE}/api/pro/status`, {headers: {'x-api-key': await siteKey()}}); }
      if (response.status === 404) storage.saveSettings({plan: {at: now(), status: OFF}});
      else if (response.ok) { const body = await response.json(); if (body.ok) storage.saveSettings({plan: {at: now(), status: {...body, ok: undefined}}}); }
    } catch { /* offline: the last answer stands */ }
    return state();
  }
  // A one-time payment for 'pro' or 'topup5' | 'topup10' | 'topup20' -> {ok, url} (the caller opens it in the browser) or {ok: false, error}.
  async function checkout(kind) {
    if (siteOffForUser()) return {ok: false, error: 'Payments are not available in this build.'};
    try {
      const response = await fetcher(`${SITE}/api/pro/checkout`, {method: 'POST', headers: {'x-api-key': await siteKey(), 'Content-Type': 'application/json'}, body: JSON.stringify({kind})});
      const body = await response.json().catch(() => ({}));
      return response.ok && body.url ? {ok: true, url: body.url} : {ok: false, error: body.error || 'Payments are not available right now.'};
    } catch { return {ok: false, error: 'Could not reach the payment page. Check your connection and try again.'}; }
  }
  // "I have Pro" on this computer: step 'start' mails a code to the address, step 'verify' (email, code, remove?) adds this computer to that Pro account.
  // -> the site's answer {ok, ...} plus status; 'devices' (409) lists the computers to choose one to remove from.
  async function signin(step, body) {
    if (siteOffForUser()) return {ok: false, error: 'Not available in this build.'};
    try {
      const response = await fetcher(`${SITE}/api/pro/signin/${step}`, {method: 'POST', headers: {'x-api-key': await siteKey(), 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      const answer = await response.json().catch(() => ({}));
      if (response.ok && step === 'verify') await refresh();
      return {...answer, ok: response.ok && answer.ok === true, status: response.status};
    } catch { return {ok: false, error: 'Could not reach Jobadabra. Check your connection and try again.'}; }
  }
  // A promo code (the site checks it; nothing about codes is known here): -> {ok, already?, credit? (euros, a credit code)} and the plan refreshed, or {ok: false, error: 'wrong' | 'expired' | 'used_up' | 'limit' | text}.
  async function redeem(code) {
    if (siteOffForUser()) return {ok: false, error: 'Not available in this build.'};
    try {
      const response = await fetcher(`${SITE}/api/pro/redeem`, {method: 'POST', headers: {'x-api-key': await siteKey(), 'Content-Type': 'application/json'}, body: JSON.stringify({code})});
      const answer = await response.json().catch(() => ({}));
      if (response.ok && answer.ok) await refresh();
      return {ok: response.ok && answer.ok === true, ...(answer.already ? {already: true} : {}), ...(answer.credit > 0 ? {credit: answer.credit} : {}), ...(answer.error ? {error: answer.error} : {})};
    } catch { return {ok: false, error: 'offline'}; }
  }
  // Where this install stands with our AI (GET /api/ai/caps): {lane, capped, message, resetsAt} or null (offline, a site without the route, a slow answer).
  // Read before an AI step starts (lib/ai-caps.js); nothing is counted at the site.
  async function caps({timeoutMs = 2500} = {}) {
    if (siteOffForUser()) return null;
    try {
      const response = await fetcher(`${SITE}/api/ai/caps`, {headers: {'x-api-key': await siteKey()}, signal: AbortSignal.timeout(timeoutMs)});
      const body = response.ok ? await response.json().catch(() => null) : null;
      return body?.ok ? {lane: body.lane, capped: body.capped || null, message: body.message || '', resetsAt: body.resetsAt || null} : null;
    } catch { return null; }
  }
  return {state, refresh, checkout, signin, redeem, caps};
}

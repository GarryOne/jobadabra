// Product analytics (PostHog, EU cloud) without PostHog's SDK: which steps people take and where they stop (setup, first search, kit,
// apply, applied), so the funnel and the paths can be read in PostHog. Only events from the list below, only short flags, numbers and
// scrubbed words as properties, never anything a person wrote or read in the app (no CV, jobs, companies, answers, mail). Since 13 Oct 2026 also time on a
// screen (active/idle seconds) and clicks as a named control + percent position (owner: "enable the heatmaps"), still no text. The id is the
// random install id; no person profile, no IP-based location, no screen recording, no autocapture. Follows the same
// "Technical reports" switch as everything else that leaves this computer.
import {scrub} from './telemetry.js';

export const EVENTS = ['app_start', 'page_view', 'setup_step', 'search_done', 'first_search_done', 'kit_prepared', 'apply_started', 'applied',
  'feedback_sent', 'update_installed', 'screen_time', 'ui_click'];
export const PAGES = ['focus', 'jobs', 'sessions', 'actions', 'calendar', 'interviews', 'strategy', 'settings', 'reports'];
// What the window may report about use (renderer/usage-signals.js): seconds on a screen, split active/idle, and a click as a control's own name plus its place in the window
// (whole percents). Anything else is dropped; no label, text or content ever travels.
const whole = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
export function usageEvent(payload) {
  const {kind, page, active, idle, control, x, y} = payload || {};
  if (!PAGES.includes(page)) return null;
  if (kind === 'screen_time' && whole(active, 3600) && whole(idle, 3600)) return {name: 'screen_time', props: {page, active, idle}};
  if (kind === 'ui_click' && typeof control === 'string' && /^[a-z][a-z0-9_-]{0,29}$/.test(control) && whole(x, 100) && whole(y, 100)) return {name: 'ui_click', props: {page, control, x, y}};
  return null;
}
// The start after an update: the version this copy ran last time and the one it runs now (a fixed-shape version, nothing else). The first start ever, the same
// version and a version that is not plain digits give nothing. update_installed was on the list from the start but nothing sent it (13 Oct 2026).
const VERSION = /^\d+\.\d+\.\d+(?:[-.][\w.]{1,20})?$/;
export const updateStep = (last, now) => VERSION.test(String(last)) && VERSION.test(String(now)) && last !== now ? {from: String(last), to: String(now)} : null;
const FLUSH_AT = 20, FLUSH_MS = 30_000, QUEUE_MAX = 100;

// Properties: lower-case names, and values that are a flag, a number, or a short word (a mode, a page, a step), scrubbed.
export function cleanProps(props = {}) {
  const out = {};
  for (const [name, value] of Object.entries(props || {}).slice(0, 12)) {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(name)) continue;
    if (typeof value === 'boolean') out[name] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[name] = Math.round(value * 100) / 100;
    else if (typeof value === 'string' && /^[\w .:+-]{1,40}$/.test(value)) out[name] = scrub(value, 40);
  }
  return out;
}

export function create({key, host = 'https://eu.i.posthog.com', installId, version, platform = process.platform, os = '', enabled = () => true,
  fetcher = globalThis.fetch, now = () => Date.now(), timers = true} = {}) {
  let queue = [], timer = null, sending = false;
  const active = !!key;
  async function flush() {
    if (!active || !queue.length || sending) return false;
    sending = true;
    const batch = queue.splice(0, 50);
    try {
      const response = await fetcher(`${host}/batch/`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({api_key: key, batch})});
      if (response && response.ok === false) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch {
      queue = [...batch, ...queue].slice(0, QUEUE_MAX);   // kept for the next try, never grown without limit
      return false;
    } finally { sending = false; }
  }
  function track(event, props = {}) {
    try {
      if (!active || !enabled() || !EVENTS.includes(event)) return false;
      queue.push({event, distinct_id: installId, timestamp: new Date(now()).toISOString(),
        properties: {...cleanProps(props), app_version: version, platform, os: String(os).slice(0, 20), $lib: 'jobadabra', $process_person_profile: false, $geoip_disable: true}});
      if (queue.length > QUEUE_MAX) queue.shift();
      if (queue.length >= FLUSH_AT) void flush();
      else if (timers && !timer) { timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS); timer.unref?.(); }
      return true;
    } catch { return false; }
  }
  return {active, track, flush, pending: () => queue.length};
}

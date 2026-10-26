// The Chrome extension's state, decided once here so the card, its pill and the "finish connecting" alert can never
// disagree. Two facts go in: whether a browser has the extension (lib/extension-install.js reads the browser's own
// profile — instant, and true even with Chrome closed) and when it last reported in (every 30 s; only a fresh report
// says the app can fill a form right now). Free of the DOM, like renderer/ai-engine-view.js, so tests can check it.
export const FRESH_MS = 90 * 1000;

// known: false only until the app has read the browser's profile — a moment, not the old 60 s grace.
// installed: the copies the browsers have, newest first. seen: {at, version} of its last report, or null.
// browserRunning: whether a browser that has it is up (null when that isn't known, e.g. the answer kept from before).
// justStarted: the window opened moments ago; the app keeps the last report in memory only, so an installed copy that has not reported
// since the start is still being checked (it reports within 30 s), not "not connected".
export function extensionState({known = true, installed = [], seen = null, browserRunning = null, now = Date.now(), justStarted = false} = {}) {
  const copy = installed[0] || null;
  const fresh = !!seen && now - (seen.at || 0) < FRESH_MS;
  if (!known) return {state: 'checking', checking: true, on: false, version: '', words: 'Checking…'};
  if (!seen && copy?.enabled && browserRunning !== false && justStarted) return {state: 'checking', checking: true, on: false, version: '', words: 'Checking…'};
  if (fresh) return {state: 'connected', checking: false, on: true, version: seen.version || copy?.version || '', words: 'Connected'};
  if (copy && !copy.enabled) return {state: 'off', checking: false, on: false, version: copy.version || '', words: 'Installed · turned off'};
  if (copy && browserRunning === false) return {state: 'closed', checking: false, on: false, version: copy.version || '', words: 'Installed · open Chrome'};
  if (copy) return {state: 'idle', checking: false, on: false, version: copy.version || '', words: 'Installed · not connected'};
  return {state: 'absent', checking: false, on: false, version: '', words: 'Not connected'};
}

// The window's first 40 s: long enough for the extension's first 30 s report after the app starts.
export const START_REPORT_MS = 40 * 1000;
export const justStarted = () => (globalThis.performance?.now?.() ?? Infinity) < START_REPORT_MS;
// The state from a record (installed copies, last report, browser up), live or kept (settings.js serviceChecks). A kept record is judged
// at the time it was taken (record.at): Connected six hours ago is still the last known state, the first paint shows it.
export const extensionFrom = (record, {justStarted: started = false} = {}) => extensionState({known: !!record, installed: record?.installed || [],
  seen: record?.seen || null, browserRunning: record?.browserUp ?? null, now: record?.at ?? Date.now(), justStarted: started});

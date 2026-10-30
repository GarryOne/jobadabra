// The alarm that reports a tab's state every 30 seconds. Chrome keeps an alarm across service-worker restarts — and
// creating an alarm that already exists *resets* its timer. The worker is woken by other events far more often than
// every 30 seconds, so `chrome.alarms.create(...)` at the top level of the worker kept pushing the alarm out of
// reach: the tab report could go a long time without ever firing (1 Oct 2026). Create it only when it is missing.
//
// Kept free of chrome.* so the decision can be tested: `get` and `create` are passed in.
/** How often the alarm reports a tab (Chrome's shortest period): the window's wait for a first report (renderer/session-state.js) and the e2e restart step's watch past a due time are derived from it. */
export const REPORT_PERIOD_MINUTES = 0.5;

/**
 * Creates the `name` alarm with `periodInMinutes` only when `get(name)` finds none. Takes the alarms API's `get` and `create` (so a test passes its own).
 * -> true when it created the alarm, false when one existed or the alarms API failed or is missing (the extension then still reports when its worker starts).
 */
export function ensureAlarm({get, create, name = 'report-tabs', periodInMinutes = REPORT_PERIOD_MINUTES}) {
  return Promise.resolve()
    .then(() => get(name))
    .then(existing => (existing ? false : Promise.resolve(create(name, {periodInMinutes})).then(() => true)))
    .catch(() => false);   // no alarms API at all: the extension still reports when the worker starts
}

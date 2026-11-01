// Names a fill that never started because the app heard nothing from the extension about the tab it opened, from the app's own log (the extension's decisions are relayed into it).
// Job: wait on state

import {appLogText} from './app-log.mjs';

const OPENED = /^(\S+) \[apply\] opened the form tab (\{.*\})\s*$/;
const SEEN = '[extension] tab: tab with the fill mark seen';

const fieldsOf = text => { try { return JSON.parse(text); } catch { return {}; } };

/**
 * '' when the app's log has the extension's "tab with the fill mark seen" for the tab the app opened last (or the app opened none); otherwise the cause as one sentence to put in front of a wait's own note.
 * `text`: the app's log (lib/app-log.mjs appLogText), each line starting with its ISO time. Pure: no clock, no read.
 * Why (1 Nov 2026, a8; stable canary 41312012476, owner: "Fix the input, no retry"): three steps failed with "the fill did not finish within 257.365 s (last seen: null)" and the only
 * evidence was in app.log: "[apply] opened the form tab {session efa5be5b, jobs.lever.co}" at 13:38:16.9, and no "tab with the fill mark seen" until 13:42:46.9, when it arrived stamped
 * extensionAt 13:38:17.5 (the extension saw the tab 0.6 s after the open) next to "[extension] log: slow push {settingsMs: 269187}": the extension's worker sat 269 s in its settings read,
 * so nothing it knew reached the app and no fill began. The fill's own note ("last seen: null") says none of that. Worded as what the app's log shows, not as "the extension never saw it",
 * because the extension did see it. Said at the step's own cap: a new inline wait is refused (Rule B, tools/e2e-reliability-check.mjs), and the open-to-heard time has no measured cap
 * of its own (calm runs: 0.2 to 7.4 s, job logs of beta 41220959824).
 */
export function lostTabNote(text) {
  const lines = String(text).split('\n');
  let opened = null;
  for (const line of lines) {
    const found = OPENED.exec(line);
    if (found) opened = {at: found[1], ...fieldsOf(found[2])};
  }
  if (!opened) return '';
  const seen = lines.some(line => line.includes(SEEN) && line.slice(0, 24) >= opened.at.slice(0, 24) && fieldsOf(line.slice(line.indexOf('{'))).session === true
    && (!opened.host || fieldsOf(line.slice(line.indexOf('{'))).host === opened.host));
  return seen ? '' : `the app heard nothing from the extension about the tab it opened (session ${opened.session}, ${opened.host || 'no host'}, opened at ${opened.at.slice(11, 19)}Z: no "tab with the fill mark seen" in its log after it)`;
}

/** lostTabNote over the profile's app log; '' when the log cannot be read: a failure's cause never hides the failure it explains (flaky-proof.test.mjs runs journeys with no profile). */
export function lostTabIn(profile) {
  try { return lostTabNote(appLogText(profile)); } catch { return ''; }
}

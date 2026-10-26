// Owns: reading the engine's output lines and the task catalog: TASKS and taskName, isDataLine, isProgressStep, STATUS_LINE, keepRunLine,
// leadStepOf, HEARTBEAT_MS, quietText, and what a finished log yields (appMessage, taskSummary, failedLine).
// Guarded by: test/progress-step.test.js, test/data-lines.test.js, test/live-status-line.test.js, test/run-kinds.test.js, test/engine-message-contract.test.js, test/live-updates.test.js.
// Split out of pipeline.js (a pure move); pipeline.js re-exports everything.
import {readable} from './pipeline-env.js';
import {CRASH_LINE} from './crash-line.js';

// How long a run was silent, for the watchdog's message: minutes for a real run, seconds when the journey shortens the limit.
export const quietText = ms => (ms < 90 * 1000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
// A line that is a JSON object is the engine's answer for the app ({"ok": true, "name": "Indeed", "jobs": 98, …}), not words for a person: it never
// becomes a task's step, its log or the window's live log (7 Oct 2026: Find jobs using your browser' banner showed it). The command's stdout still has it for its caller.
export function isDataLine(line) {
  const text = String(line).trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return false;
  try { return typeof JSON.parse(text) === 'object'; } catch { return false; }
}
// A one-off job the Actions page (or its Telegram command) starts: an insight, the weekly report, today's list,
// finding new employers. Tracked like a search, so Recent activity shows it running, then its result line
// (the one the pipeline prints, e.g. "Insight sent: Skills — …") and its Notion ⏱️ Search runs row.
export const TASKS = {
  insight: {name: 'Insight', result: /^(Insight sent: |Insight: )/},
  weekly: {name: 'Search analysis', result: /^Weekly report sent: /},
  kits: {name: 'Prepare top matches', result: /^Kits ready: /},
  visits: {name: 'Find jobs using your browser', result: /^Read \d+ of \d+ sites?/},
  tailor: {name: 'Tailor CV + cover letter', result: /^Tailored \d+ of \d+ CV/},
  today: {name: "Today's list", result: /^(Digest ready: |No new jobs since|Sent \d+ Telegram message)/},
  // The older wording, and the card's second line: "7 checked · 7 new to the search · 2 new sources" (counts between the two may come and go; 3c45aa3 added one).
  scout: {name: 'More employers', result: /Source scout(<\/b>)? · checked|^Source scout is off|^\d+ checked · (?:.* · )?\d+ new sources?\b/},
};
export const taskName = kind => TASKS[kind]?.name || (kind === 'mail' ? 'Gmail check' : 'Find jobs');
export function failedLine(log) {
  const line = (log || []).map(String).find(entry => /^\s*✗ \S/.test(entry));
  return line ? line.replace(/^\s*✗\s*/, '').replace(/: skipped, you can close its tab$/, '').slice(0, 240) : undefined;
}
// Without Telegram the pipeline prints its message between <<<message / message>>> (src/telegram.py to_app);
// the last one, as plain text (Telegram HTML removed), is what the app shows as the result.
export function appMessage(log) {
  const end = log.lastIndexOf('message>>>'), start = log.lastIndexOf('<<<message', end);
  if (end < 0 || start < 0) return null;
  return readable(log.slice(start + 1, end).join('\n')).trim().slice(0, 6000) || null;
}
// The result line a task printed, made readable: "Insight sent: Skills — Go in 40% (0.012 USD)" -> "Skills — Go in 40%".
export function taskSummary(kind, log) {
  const line = log.filter(entry => TASKS[kind]?.result.test(entry)).pop();
  return line ? readable(line).replace(/^(Insight sent|Weekly report sent|Insight): /, '')
    .replace(/^🔎 Source scout · /, '').replace(/\s*\([\d.]+ USD\)$/, '').trim() : null;
}
// A line of the engine's output that says what it is doing now (the banner's and the activity's step): not an indented line, a warning, a long line, or the traceback
// and exception line of a crash (its row is still being closed while those print, and the run shows as running until then), or a Claude Code timing line
// (7 Oct 2026: "Claude Code haiku: answered in 146 s…" stood as the search's step for 10 min while it sorted job titles).
export const isProgressStep = line => !/^\s|^Warning|^Cronjob run logged|^Claude Code \S+: answered in /.test(line) && line.length < 120 && !CRASH_LINE.test(line);

// STATUS_LINE and keepRunLine: shared with the window's own live log (renderer/run-lines.js).
export {STATUS_LINE, keepRunLine} from '../renderer/run-lines.js';
// The Log box's live step for a line of engine output: a "⏳ …" step as written, or the wait for the run lock as a plain sentence
// ("Waiting for a discover run started 14:27 to finish · 2 min"); null for anything else. 6 Oct 2026: a log sat on "Starting… 76 s" behind a
// background search, because that wait line is not a "⏳" step.
export function leadStepOf(line) {
  const step = /^⏳\s*(.+)/.exec(line);
  if (step) return step[1];
  const wait = /^Another Jobadabra search is running .*?waiting for (.+?)(?: \(pid \d+\))?; waited (\d+) min/.exec(line);
  return wait ? `Waiting for ${wait[1]} to finish${+wait[2] ? ` · ${wait[2]} min` : ''}` : null;
}
export const HEARTBEAT_MS = {every: 15 * 1000, quiet: 30 * 1000};

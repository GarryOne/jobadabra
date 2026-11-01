// When a live run may end before its limit: the page (and what the app logs about it) has not changed for STILL seconds (11 Oct 2026, owner: "end a live run 20 s after the
// page last changed, keep 90 s as the limit"). A still page is the end of the story: a held run waits for nothing more. A page that is only slow (a form drawn after a spinner,
// a model answering) changes its tabs, its controls or the app's log, which moves the clock. LIVE_STILL_SECONDS=0 turns it off. Guard: test/live-still.test.mjs.
export const STILL_SECONDS = 20;
export const STILL_SECONDS_CLI = 45;   // plan-path (claude -p) asks take 5-12 s each: 20 s of quiet ended runs while the AI was still thinking, a false "form empty" (11 Oct 2026)
export const stillSeconds = (env = process.env, engine = '') => (env.LIVE_STILL_SECONDS === undefined || env.LIVE_STILL_SECONDS === '' ? (engine === 'cli' ? STILL_SECONDS_CLI : STILL_SECONDS) : Math.max(0, Number(env.LIVE_STILL_SECONDS) || 0));

// After the extension says its run ended for the application (extension/ladder/progress.js: "fill: run ended", from ladder/silence.js endSilence: the door spoke or the page was
// handed to the person) the quiet window is shorter: what may still come is a shadow check's one AI ask (an offline replay keeps the live AI's time, capped at 20 s). Measured
// 14 Oct 2026 on the first CI replay run: ~45 of a row's ~93 s was this window after the last line. A progress note after the end means the run went on: the full window again.
export const AFTER_END_SECONDS = 25;   // 20 s (the replayed AI's cap) + a margin for the watch's own 1.5 s turns
// What says the application moved on after an end (14 Oct 2026, arbeitnow board -> employer: the board tab's end cut the row to 46 s while the employer
// page, opened by its press, was still being read): a progress note, the mark carried to a next page, a panel on another tab, a new page's kind.
const MOVED_ON = /fill: progress:|panel: mark carried|panel: panel on a tab|\] page kind: |fill: page kind: /g;
const lastMove = text => { let at = -1; for (const found of text.matchAll(MOVED_ON)) at = found.index; return at; };
export const runEnded = (logText = '') => { const text = String(logText); return text.lastIndexOf('fill: run ended') > lastMove(text); };
// tabs: {now, atEnd} the application's open tabs this turn and when its end was first seen (apply-live.mjs): a tab opened after the end (an Apply that
// opened the employer's page) gives the full window back even before that page writes a line (cc's review of #739, 14 Oct 2026).
export const quietSeconds = (seconds, logText = '', env = process.env, tabs = null) => {
  const after = env.LIVE_AFTER_END_SECONDS === undefined || env.LIVE_AFTER_END_SECONDS === '' ? AFTER_END_SECONDS : Math.max(0, Number(env.LIVE_AFTER_END_SECONDS) || 0);
  const newTab = tabs && Number.isFinite(tabs.atEnd) && tabs.now > tabs.atEnd;
  return seconds > 0 && runEnded(logText) && !newTab ? Math.min(seconds, after) : seconds;
};

// What the clock watches: the tabs and fill states, the session's stage, the page's visible shape (url, title, how many controls and buttons), how many log lines the app wrote.
export const signature = ({states = [], stage = '-', status = '-', shape = '', logLines = 0} = {}) => JSON.stringify([states, stage, status, shape, logLines]);

// -> {see(sig, at), stillFor(at), over(at, {opened})}: `at` in ms. The run may end only once the posting has been opened in the browser (before that, "Apply never opened" is its own failure).
export function stillClock({seconds = STILL_SECONDS, startedAt = 0} = {}) {
  let last = '', changedAt = startedAt;
  return {
    see(sig, at) { if (sig !== last) { last = sig; changedAt = at; return true; } return false; },
    stillFor: at => at - changedAt,
    over: (at, {opened = false, deciding = false, quiet = seconds} = {}) => quiet > 0 && opened && !deciding && at - changedAt >= quiet * 1000,   // quiet: this turn's window (quietSeconds: shorter once the run ended)   // deciding: the extension's own step line is up (lib/deciding.mjs): the limit, not the quiet window, ends the run
  };
}

// How many of the app's log lines are about the page and the fill (the extension's, the review's, the page-kind's): the app's own heartbeat (a store call every 15 s) is not news.
export const PAGE_LINE = /\[(extension|review|page-kind|applied|misses)\]/;
export const pageLines = lines => lines.filter(line => PAGE_LINE.test(line)).length;

// The most a live row runs while the extension is still on a step: twice its limit (record-once spec, 15 Oct 2026: a plan-path ask takes ~28 s and a press climbs 3-5 asks, so the
// 90 s limit cut a recording while the extension still worked). LIVE_HARD_SECONDS sets it (never below the limit; 0 or below = no extra time).
export const hardCapMs = (seconds, env = process.env) => (env.LIVE_HARD_SECONDS === undefined || env.LIVE_HARD_SECONDS === '' ? seconds * 2 : Math.max(seconds, Number(env.LIVE_HARD_SECONDS) || 0)) * 1000;

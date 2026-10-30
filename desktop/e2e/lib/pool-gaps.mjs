// Job: report health
// The gaps between a pool row's progress notes (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 2: the silent dead-end rule's T is measured, not guessed).
// Reads the extension's "progress: <kind>" lines (extension/ladder/progress.js) from each row's app log. A row is one application: a gap is the wall-clock time between two notes in
// any of its tabs (the extension's per-tab sinceMs would count the posting tab as silent forever once Apply opened a new one); the tail is the silence from the last note to the log's
// end. Activity without progress (presses, judgments) counts as silence. The silent rule is applied to the same lines with the extension's own rule (ladder/silence.js isSilent,
// handedToPerson), so the detector's recall and false fires are measured offline on any run (phase 2 box 3). Pure: callers provide report data and log text. Guard: e2e/test/pool-gaps.test.mjs.
import {PROGRESS_KINDS} from '../../../extension/ladder/progress.js';
import {SILENT_AFTER_MS, handedToPerson} from '../../../extension/ladder/silence.js';
import {STEPS} from './record-sites.mjs';

const PROGRESS_LINE = /^(\S+Z) \[extension\] fill: progress: (\w+)(?: \{.*\})?$/;
const ANY_LINE = /^(\S+Z) \[/;
const DOOR = /^(\S+Z) \[extension\] fill: dead end: [a-z_-]+ (\{.*\})\s*$/;
const JUDGE = /^(\S+Z) \[extension\] panel: application form ready\?: ([a-z_]+) (\{.*\})\s*$/;   // form-ready.js's line (the test reads that it still writes it)
// The asks to the app that a log shows, as spans [from, to] ms: a line that reports how long the answer took ends at its own time (the AI's answers to a form's questions, the page-kind ask). The
// silent clock stands still during an ask (extension/ladder/silence.js askStarted); the extension logs no ask start, so these spans are the lower bound of what it excludes.
const ASK_LINE = /^(\S+Z) \[(?:fill\] Claude answered|extension\] fill: page kind:)[^{]*(\{.*\})\s*$/;
export function askSpans(appLog = '') {
  const spans = [];
  for (const text of String(appLog).split('\n')) {
    const found = ASK_LINE.exec(text), ms = found ? Number(parsed(found[2]).ms) : NaN;
    if (found && ms > 0) { const to = Date.parse(found[1]); spans.push([to - ms, to]); }
  }
  return spans;
}
const overlap = (spans, from, to) => spans.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
// The time between two instants that was not spent waiting on an ask.
export const quietBetween = (spans, from, to) => Math.max(0, to - from - overlap(spans, from, to));
const parsed = text => { try { return JSON.parse(text); } catch { return {}; } };   // a cut line: no field

// appLog -> [{at, kind}], in the log's order
export const progressOf = (appLog = '') => String(appLog).split('\n').map(text => PROGRESS_LINE.exec(text)).filter(found => found && PROGRESS_KINDS.includes(found[2]))
  .map(([, at, kind]) => ({at: Date.parse(at), kind}));

// The door's lines (extension/ladder/dead-end.js), told apart by their shadow field (never their words): -> {stops, seen} (seen: the silent rule's shadow notices).
export function doorLines(appLog = '') {
  let stops = 0, seen = 0;
  for (const found of String(appLog).split('\n').map(text => DOOR.exec(text)).filter(Boolean)) { const fields = parsed(found[2]); if (fields.level === 'control') continue; if (fields.shadow === true) seen++; else stops++; }   // a control's door (ladder/control-door.js) is neither: it ends nothing
  return {stops, seen};
}

// appLog -> {events, gaps: [{ms, kind: the note that ended the wait}], maxGapMs, tailMs, deadEnd, silent}. tailMs null when the row has no note (a build before the notes, or no page
// considered); deadEnd: the door reported a stop; silent: how many times the silent rule noted the application in shadow.
export function rowGaps(appLog = '') {
  const notes = progressOf(appLog);
  const spans = askSpans(appLog);
  const gaps = notes.slice(1).map((note, i) => ({ms: note.at - notes[i].at, quietMs: quietBetween(spans, notes[i].at, note.at), kind: note.kind}));
  const end = logEnd(appLog), door = doorLines(appLog);
  return {events: notes.length, gaps, maxGapMs: Math.max(0, ...gaps.map(gap => gap.ms)), maxQuietMs: Math.max(0, ...gaps.map(gap => gap.quietMs)), tailMs: notes.length && end != null ? end - notes.at(-1).at : null, deadEnd: door.stops > 0, silent: door.seen};
}

const logEnd = appLog => {
  const times = String(appLog).split('\n').map(text => ANY_LINE.exec(text)).filter(Boolean).map(found => Date.parse(found[1])).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
};

// The run's events in log order, as the extension's silence clock sees them: a progress note restarts it; the door's stop (not a shadow notice) or a page handed to the person ends it.
export function runEvents(appLog = '') {
  const events = [];
  for (const text of String(appLog).split('\n')) {
    const note = PROGRESS_LINE.exec(text), door = DOOR.exec(text), judge = JUDGE.exec(text);
    if (note && PROGRESS_KINDS.includes(note[2])) events.push({at: Date.parse(note[1]), type: 'progress', kind: note[2]});
    else if (door && parsed(door[2]).shadow !== true && parsed(door[2]).level !== 'control') events.push({at: Date.parse(door[1]), type: 'end', why: 'door'});
    else if (judge && handedToPerson({answer: judge[2], step: parsed(judge[3]).step})) events.push({at: Date.parse(judge[1]), type: 'end', why: 'handed'});
  }
  return events;
}

// The silent rule at T over a row's log: -> {fires: [{afterMs: since the first note, kind: the last note before the silence}], openTailMs: the silence at the log's end while the run
// had not ended and the rule had not fired (the pool cut the row before T: censored)}.
export function silentFires(appLog = '', T = SILENT_AFTER_MS, {asks = true} = {}) {
  const fires = [], spans = asks ? askSpans(appLog) : [];
  let clock = null, first = null;
  const check = at => {
    if (!clock || clock.ended || clock.noticed || quietBetween(spans, clock.at, at) < T) return;
    clock.noticed = true;
    let due = clock.at + T;   // the instant its quiet time reached T: the asks inside the wait push it later
    for (let again = 0; again < 8; again++) due = clock.at + T + overlap(spans, clock.at, due);
    fires.push({afterMs: Math.min(at, due) - first, kind: clock.kind});
  };
  for (const event of runEvents(appLog)) {
    check(event.at);
    if (event.type === 'progress') { first ??= event.at; clock = {at: event.at, kind: event.kind, ended: false, noticed: false}; } else if (clock) clock.ended = true;
  }
  const end = logEnd(appLog);
  if (end != null) check(end);
  return {fires, openTailMs: clock && !clock.ended && !clock.noticed && end != null ? quietBetween(spans, clock.at, end) : null};
}

// The dead-end detector on the pool's ground truth (spec phase 2 box 3), at T: rows that stopped before the form vs rows that reached it; the test's own holds and rows with no ending
// are not outcomes. Detected = the door spoke or the silent rule fired. censored: a stopped row the pool cut while silent for at least stillMs but less than T.
const FORM_STEP = STEPS.indexOf('form');
export function detectorAt(report = {}, logs = {}, T = SILENT_AFTER_MS, stillMs = 20000, opts = {}) {
  const ran = Array.isArray(report.thisRun?.ran) ? new Set(report.thisRun.ran) : null;
  const out = {T, stopped: 0, detected: 0, silentOnly: 0, missed: [], censored: 0, reached: 0, falseFires: []};
  for (const [row, item] of Object.entries(report.results || {})) {
    if ((ran && !ran.has(row)) || !item?.ending || item.ending === 'held' || !progressOf(logs[row]).length) continue;
    const {fires, openTailMs} = silentFires(logs[row], T, opts), door = doorLines(logs[row]).stops > 0;
    if (STEPS.indexOf(item.reached) >= FORM_STEP) { out.reached++; if (fires.length) out.falseFires.push(row); continue; }
    out.stopped++;
    if (door || fires.length) out.detected++;
    if (!door && fires.length) out.silentOnly++;
    if (!door && !fires.length) { out.missed.push(row); if (openTailMs >= stillMs) out.censored++; }
  }
  return out;
}

// A row's app log file in a smoke reports folder: the name record-sites.mjs writes (the test reads record-sites.mjs for the same expression).
export const appLogName = (day, shape) => `${day}-${shape.replace(/\W+/g, '-')}.app.log`;

// report: the day report (record-sites.mjs); logs: {row: app log text}. -> one row per row THIS run ran, with its ending.
export function gapRows(report = {}, logs = {}) {
  const ran = Array.isArray(report.thisRun?.ran) ? new Set(report.thisRun.ran) : null;
  return Object.entries(report.results || {}).filter(([row]) => !ran || ran.has(row)).map(([row, item]) => {
    const gaps = rowGaps(logs[row] || '');
    return {row, ending: item?.ending || '', reached: item?.reached || '', ...gaps, measured: gaps.events > 0};
  });
}

export const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
};

// rows -> the numbers T is chosen from: every gap's quantiles, and the slowest gap on rows that reached the form (a normal run's slowest wait).
export function gapSummary(rows = []) {
  const measured = rows.filter(row => row.measured), all = measured.flatMap(row => row.gaps.map(gap => gap.ms));
  const ready = measured.filter(row => row.ending === 'ready').flatMap(row => row.gaps.map(gap => gap.ms));
  return {measured: measured.length, notMeasured: rows.length - measured.length, gaps: all.length,
    p50: quantile(all, 0.5), p90: quantile(all, 0.9), p95: quantile(all, 0.95), p99: quantile(all, 0.99), max: all.length ? Math.max(...all) : null, quietMax: measured.flatMap(row => row.gaps.map(gap => gap.quietMs)).reduce((a, b) => Math.max(a, b), 0), maxReady: ready.length ? Math.max(...ready) : null};
}

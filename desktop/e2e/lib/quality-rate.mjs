// How steady the AI is, as a rate over the last 90 score pairs of the night's live quality runs (owner, 27 Oct 2026: "Code gate + AI rate"; bars "Below 80% of
// last 90", "Above 2% of last 90"). The live run scores the golden jobs twice, adds its night to a history the workflow keeps between nights (e2e.yml, cache
// quality-rate-*), and is red only when the rate breaks a bar. /admin/operations/e2e draws the same rate (jobadabra-web admin/e2e-quality.js).
// Guard: test/quality-rate.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const BARS = {pairs: 90, agree: 0.8, jumps: 0.02, within: 8, jump: 20};
// Below this many pairs the rate is reported, not judged: one night is 9 pairs, and one wobbly night must not turn main red by itself.
export const MIN_PAIRS = 45;
const KEEP_NIGHTS = 60;

// The two scorings of one run ({jobId: score}) -> its night.
export function nightOf(first, second, {runId, day}) {
  const gaps = Object.keys(first).filter(id => second[id] != null && first[id] != null).map(id => Math.abs(first[id] - second[id]));
  return {runId, day, pairs: gaps.length, within8: gaps.filter(gap => gap <= BARS.within).length, over20: gaps.filter(gap => gap > BARS.jump).length};
}

const whole = value => Number.isInteger(value) && value >= 0;
const valid = night => night && (Number.isInteger(night.runId) || typeof night.runId === 'string') && night.runId !== '' && whole(night.pairs) && night.pairs > 0
  && whole(night.within8) && whole(night.over20) && night.within8 <= night.pairs && night.over20 <= night.pairs;

// Newest first. A run adds its night once: its retry measures the same history (a red rate stays red), never a better second draw.
export function addNight(history, night) {
  if (history.some(item => item.runId === night.runId)) return history;
  return [night, ...history].slice(0, KEEP_NIGHTS);
}

// Nights newest first -> the newest nights that hold the last 90 pairs (fewer while the history is short).
export function rateOf(nights = []) {
  const used = [];
  let pairs = 0;
  for (const night of nights) { if (pairs >= BARS.pairs) break; used.push(night); pairs += night.pairs; }
  const sum = field => used.reduce((total, night) => total + night[field], 0);
  return {nights: used.length, pairs, within8: sum('within8'), over20: sum('over20')};
}

const pct = (part, whole) => `${Math.round((part / whole) * 1000) / 10}%`;
// -> {ok, judged, line, problems}.
export function rateVerdict(rate) {
  const judged = rate.pairs >= MIN_PAIRS;
  const line = rate.pairs ? `${pct(rate.within8, rate.pairs)} of the last ${rate.pairs} score pairs within ${BARS.within} points (bar ${BARS.agree * 100}%), `
    + `${pct(rate.over20, rate.pairs)} more than ${BARS.jump} apart (bar ${BARS.jumps * 100}%), ${rate.nights} night(s)` : 'no score pair yet';
  const problems = !judged ? [] : [
    ...(rate.within8 / rate.pairs < BARS.agree ? [`only ${rate.within8} of ${rate.pairs} pairs (${pct(rate.within8, rate.pairs)}) scored within ${BARS.within} points, under the ${BARS.agree * 100}% bar`] : []),
    ...(rate.over20 / rate.pairs > BARS.jumps ? [`${rate.over20} of ${rate.pairs} pairs (${pct(rate.over20, rate.pairs)}) moved more than ${BARS.jump} points, over the ${BARS.jumps * 100}% bar`] : [])];
  return {ok: !problems.length, judged, line: judged ? line : `${line}; judged from ${MIN_PAIRS} pairs`, problems};
}

export function readHistory(file) {
  if (!file) return [];
  try { const list = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(list) ? list.filter(valid) : []; } catch { return []; }
}
export function writeHistory(file, history) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(history));
}

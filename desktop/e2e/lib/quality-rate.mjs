// How steady and right the AI is, as rates over the night's live quality runs (owner, 27 Oct 2026: "Code gate + AI rate"; for facts and judge flags "Yes, same
// shape"). Bars: scores "Below 80% of last 90" pairs within 8 and "Above 2% of last 90" more than 20 apart; facts "≥ 99.5% of ~10 nights" exact; judge flags
// "≤ 10% of last 90 texts". The live run adds its night to a history the workflow keeps between nights (e2e.yml, cache quality-rate-*), and a step is red only
// when its rate breaks a bar; the gate (replayed answers) still checks every fact and the per-run judge allowance exactly. /admin/operations/e2e draws the same
// rates (jobadabra-web admin/e2e-quality.js). Guard: test/quality-rate.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

// Why (#2211, #2214, owner 27 Oct 2026): his bars, set from 34 live runs' measured noise (scores 85.4% within 8; facts 2,079/2,079; flags 5.9%, worst 8.9%).
export const BARS = {pairs: 90, agree: 0.8, jumps: 0.02, within: 8, jump: 20, factNights: 10, facts: 0.995, texts: 90, flagged: 0.1};
// Below these the rate is reported, not judged (half of each window): one bad night must not turn main red by itself.
export const MIN_PAIRS = 45, MIN_FACT_NIGHTS = 5, MIN_TEXTS = 45;
const KEEP_NIGHTS = 60;
const GROUPS = [['pairs', 'within8', 'over20'], ['factsExact', 'factsTotal'], ['judged', 'flagged']];

// The two scorings of one run ({jobId: score}) -> its night's score pairs.
export function nightOf(first, second, {runId, day}) {
  const gaps = Object.keys(first).filter(id => second[id] != null && first[id] != null).map(id => Math.abs(first[id] - second[id]));
  return {runId, day, pairs: gaps.length, within8: gaps.filter(gap => gap <= BARS.within).length, over20: gaps.filter(gap => gap > BARS.jump).length};
}

const whole = value => Number.isInteger(value) && value >= 0;
const has = (night, group) => group.some(key => night[key] != null);
// A night adds up: a run id, at least one part, every count of a part it has a whole number, and the parts' own sums right.
function valid(night) {
  if (!night || !(Number.isInteger(night.runId) || typeof night.runId === 'string') || night.runId === '') return false;
  const parts = GROUPS.filter(group => has(night, group));
  if (!parts.length || !parts.every(group => group.every(key => whole(night[key])))) return false;
  const [scores, facts, flags] = GROUPS.map(group => has(night, group));
  return (!scores || (night.pairs > 0 && night.within8 <= night.pairs && night.over20 <= night.pairs))
    && (!facts || night.factsExact <= night.factsTotal) && (!flags || night.flagged <= night.judged);
}

// Newest first. A run adds each part of its night once (scores, facts, judge flags, each by its own step): its retry measures the same history, so a red
// rate stays red, never a better second draw.
export function addNight(history, night) {
  const at = history.findIndex(item => item.runId === night.runId);
  if (at < 0) return [night, ...history].slice(0, KEEP_NIGHTS);
  const kept = {...history[at]};
  for (const group of GROUPS) if (!has(kept, group) && has(night, group)) for (const key of group) kept[key] = night[key];
  return history.map((item, index) => (index === at ? kept : item));
}

// The newest nights that hold `size` of `field` (fewer while the history is short), among the nights that have it.
function newest(nights, field, size) {
  const used = [];
  let total = 0;
  for (const night of nights) { if (total >= size) break; if (!(night[field] > 0)) continue; used.push(night); total += night[field]; }
  return used;
}
const sum = (nights, field) => nights.reduce((total, night) => total + night[field], 0);

// Nights newest first -> each rate's window: the last 90 score pairs, the last 10 nights' facts, the last 90 judged texts.
export function rateOf(nights = []) {
  const scored = newest(nights, 'pairs', BARS.pairs), facts = nights.filter(night => night.factsTotal > 0).slice(0, BARS.factNights), judged = newest(nights, 'judged', BARS.texts);
  return {nights: scored.length, pairs: sum(scored, 'pairs'), within8: sum(scored, 'within8'), over20: sum(scored, 'over20'),
    facts: {nights: facts.length, exact: sum(facts, 'factsExact'), total: sum(facts, 'factsTotal')},
    flags: {nights: judged.length, texts: sum(judged, 'judged'), flagged: sum(judged, 'flagged')}};
}

const pct = (part, all) => `${Math.round((part / all) * 1000) / 10}%`;
const verdict = (judged, line, problems, from) => ({ok: !problems.length, judged, line: judged ? line : `${line}; judged from ${from}`, problems});

// Score steadiness -> {ok, judged, line, problems}.
export function rateVerdict(rate) {
  const judged = rate.pairs >= MIN_PAIRS;
  const line = rate.pairs ? `${pct(rate.within8, rate.pairs)} of the last ${rate.pairs} score pairs within ${BARS.within} points (bar ${BARS.agree * 100}%), `
    + `${pct(rate.over20, rate.pairs)} more than ${BARS.jump} apart (bar ${BARS.jumps * 100}%), ${rate.nights} night(s)` : 'no score pair yet';
  const problems = !judged ? [] : [
    ...(rate.within8 / rate.pairs < BARS.agree ? [`only ${rate.within8} of ${rate.pairs} pairs (${pct(rate.within8, rate.pairs)}) scored within ${BARS.within} points, under the ${BARS.agree * 100}% bar`] : []),
    ...(rate.over20 / rate.pairs > BARS.jumps ? [`${rate.over20} of ${rate.pairs} pairs (${pct(rate.over20, rate.pairs)}) moved more than ${BARS.jump} points, over the ${BARS.jumps * 100}% bar`] : [])];
  return verdict(judged, line, problems, `${MIN_PAIRS} pairs`);
}

// Facts written exactly over the last 10 nights -> {ok, judged, line, problems}.
export function factsVerdict({facts}) {
  const judged = facts.nights >= MIN_FACT_NIGHTS;
  const line = facts.total ? `${pct(facts.exact, facts.total)} of the last ${facts.total} facts exact (bar ${BARS.facts * 100}%), ${facts.nights} night(s)` : 'no fact checked yet';
  const problems = judged && facts.exact / facts.total < BARS.facts ? [`only ${facts.exact} of ${facts.total} facts (${pct(facts.exact, facts.total)}) were exact over the last ${facts.nights} nights, under the ${BARS.facts * 100}% bar`] : [];
  return verdict(judged, line, problems, `${MIN_FACT_NIGHTS} nights`);
}

// Score texts the judge flagged (invented or contradicting) over the last 90 -> {ok, judged, line, problems}.
export function flagsVerdict({flags}) {
  const judged = flags.texts >= MIN_TEXTS;
  const line = flags.texts ? `${pct(flags.flagged, flags.texts)} of the last ${flags.texts} score texts flagged (bar ${BARS.flagged * 100}%), ${flags.nights} night(s)` : 'no score text judged yet';
  const problems = judged && flags.flagged / flags.texts > BARS.flagged ? [`${flags.flagged} of ${flags.texts} score texts (${pct(flags.flagged, flags.texts)}) were flagged over the last ${flags.nights} nights, over the ${BARS.flagged * 100}% bar`] : [];
  return verdict(judged, line, problems, `${MIN_TEXTS} texts`);
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
// Read, add this run's part of the night, write back -> the history (the suite's steps each call it with their own part).
export function recordNight(file, night) {
  const history = addNight(readHistory(file), night);
  writeHistory(file, history);
  return history;
}

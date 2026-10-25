// The top of a run's one result card in its run panel (owner, 25 Oct 2026: "Instead of having 3 cards representing the status/result, there should be one
// single card… consistent across runs"): how it ended, the one number and the next step. Pure: the number's words are the app's own (find-card-model.js
// addedWords, the Jobs card's), the next step the Actions banner's (run-compact.js NEXT), so the two never disagree. Drawn by pages/activity-result-top.js.
// Guarded by test/run-result-card.test.js.
import {addedWords} from './find-card-model.js';
import {NEXT} from './run-compact.js';
import {runPill} from './run-status.js';

// The kinds whose result card has its top on a clean run too (Find jobs first; the other kinds follow in their own PRs).
export const CLEAN_TOP = new Set(['search']);
// The one number a kind's result is about, as words, or '' when the kind has none yet.
export const NUMBER = {search: added => addedWords(added)};

// The top's tone is the run's pill tone (run-status.js runPill), so the two never disagree: a "Completed with warnings" pill is never a green top,
// a red "Failed" pill never an amber one (owner, 25 Oct 2026: "It should not contradict").
export const TOP_TONES = ['good', 'warn', 'bad', 'neutral', 'info'];
export const topTone = (run, kind) => (run ? runPill({...run, kind}, {long: true})[1] : 'neutral');
const ICONS = {good: 'check-circle', warn: 'alert', bad: 'alert', neutral: 'pulse', info: 'pulse'};

// A run that ended without a problem: {tone, icon, title, next} for a kind in CLEAN_TOP, else null (its own card says it, or the No result box does).
export function cleanTop(run, {kind, added = 0} = {}) {
  if (!run || run.live || run.waiting || !CLEAN_TOP.has(kind)) return null;
  const [label, tone] = runPill({...run, kind}, {long: true});
  if (label === 'No result') return null;
  const step = NEXT[kind], counts = {added, asks: 0};
  const next = step && (!step.when || step.when(counts)) ? {label: step.label(counts), view: step.view} : null;
  return {tone, icon: ICONS[tone] || 'pulse', title: NUMBER[kind]?.(added) || '', next};
}

// A problem's title with the kind's number after it, so the top says what the run left behind: "Find jobs was interrupted · No jobs added to your list".
export const titleWithNumber = (title, kind, added = 0) => (NUMBER[kind] ? `${title} · ${NUMBER[kind](added)}` : title);

// Apply triage's pure parts (spec 2026-10-30-apply-triage, PR B): which jobs the popup picks (the best N not checked before), and the chip each read shows. No window, no I/O.
import {modeOfRead} from './apply-triage-mode.js';

/**
 * The jobs the popup checks: the best `n` by fit among the jobs not checked before (owner, 30 Oct 2026: "the one that were not triaged before").
 * `isChecked(job)` says a job has a read already; jobs with no fit count as -1, so they come last. Returns a new array; the input is not changed.
 */
export function pickForTriage(jobs = [], {n = 10, isChecked = () => false} = {}) {
  const fitOf = job => (Number.isFinite(job?.fit) ? job.fit : -1);
  const ranked = [...jobs].filter(job => job?.url && !isChecked(job)).sort((a, b) => fitOf(b) - fitOf(a));
  return ranked.slice(0, Math.max(0, Math.floor(n)));
}

export const CHIPS = {
  auto: {label: 'Can apply automatically', tone: 'good'},
  fill: {label: 'You review and submit', tone: 'info'},
  check: {label: 'Needs you', tone: 'warn'},
  none: {label: 'Skipped', tone: 'neutral'},
};

/** The chip for a job's read: {label, tone, detail}. No read yet is "Not checked", never a guess. */
export function chipOf(read) {
  if (!read) return {label: 'Not checked', tone: 'neutral', detail: ''};
  const {mode, reason} = modeOfRead(read);
  return {...CHIPS[mode], detail: reason};
}

// Why (30 Oct 2026, owner's "go" on the measured read): one real form-judge call on the Claude plan took 49 s wall; a first check has no timings yet, so the guess is a minute a job and says so.
const FIRST_GUESS_SECONDS = 60;
/** How many of the latest real read timings are kept and counted (one source for the stored window and the median). */
export const KEEP_TIMINGS = 10;

/**
 * How long checking `count` jobs takes, one at a time: the median of the last ten real read timings (seconds) on this Mac, or a first guess before any.
 * Takes the job count and the timings (bad numbers are ignored); returns {seconds, text, measured}, text '' when there is nothing to check.
 */
export function estimateOf(count, timings = []) {
  const usable = (timings || []).filter(value => Number.isFinite(value) && value > 0).slice(-KEEP_TIMINGS).sort((a, b) => a - b);
  const middle = Math.floor(usable.length / 2);
  const perJob = usable.length ? (usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2) : FIRST_GUESS_SECONDS;
  const seconds = Math.round(perJob * Math.max(0, count));
  if (!count) return {seconds: 0, text: '', measured: usable.length > 0};
  const minutes = Math.max(1, Math.round(seconds / 60));
  const text = seconds < 45 ? `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds` : `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return {seconds, text, measured: usable.length > 0};
}

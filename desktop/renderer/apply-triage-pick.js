// Apply triage's pure parts (spec 2026-10-30-apply-triage, PR B): which jobs the popup picks, and the chip each read shows. No window, no I/O.
import {modeOfRead} from './apply-triage-mode.js';

/**
 * The jobs the popup checks: the best `n` by fit (the default, decision 2), or every job at or above `minFit` (capped at `n`).
 * Jobs with no fit count as -1, so they come last. Returns new arrays; the input is not changed.
 */
export function pickForTriage(jobs = [], {choice = 'best', n = 10, minFit = 0} = {}) {
  const fitOf = job => (Number.isFinite(job?.fit) ? job.fit : -1);
  const ranked = [...jobs].filter(job => job?.url).sort((a, b) => fitOf(b) - fitOf(a));
  const eligible = choice === 'fit' ? ranked.filter(job => fitOf(job) >= minFit) : ranked;
  return eligible.slice(0, Math.max(0, Math.floor(n)));
}

const CHIPS = {
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

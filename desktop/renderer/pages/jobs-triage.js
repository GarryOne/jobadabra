// Apply triage on the Jobs screen (spec 2026-10-30-apply-triage, PR B): the button, the popup (which jobs, how many), the progress with Cancel, and the chip on each job.
// The form read itself is the hidden browser's (lib/triage-reader.js); a job that was not read keeps its "Not checked" chip.
import {chip} from '../components.js';
import {$} from './core.js';
import {chipOf, pickForTriage} from '../apply-triage-pick.js';
import {shared} from './shared.js';

// The reads this window knows, by job URL: {read, at}. PR C fills it from the hidden browser's reads; nothing is stored here yet.
const reads = new Map();
/** The read of a job, by its URL, or null when it has none. Takes the job's URL; never throws; the data is the reads this window holds (filled by setRead). */
export const readOf = url => reads.get(url)?.read || null;
/** Stores one job's read with the time it was read. Takes the URL and the read; returns nothing; a repeat read replaces the last one. */
export const setRead = (url, read) => reads.set(url, {read, at: new Date().toISOString()});

/** The chip for a job's row on the board: the mode of its last read, or "Not checked". */
export function triageChip(job) {
  const {label, tone, detail} = chipOf(readOf(job?.url));
  return chip(label, {tone, detail, title: detail || 'Not read yet: press "See which jobs can apply automatically"'});
}

let cancelled = false, running = false;   // one run at a time: a second Start while one runs does nothing

// The popup's choice: 10 best matches (the default, decision 2), or every job at or above a fit.
function choiceNow() {
  const fitOn = $('triage-by-fit')?.getAttribute('aria-pressed') === 'true';
  return {choice: fitOn ? 'fit' : 'best', n: Number($('triage-n')?.value) || 10, minFit: Number($('triage-fit')?.value) || 0};
}

function paintCount() {
  const picked = pickForTriage(shared.allJobs || [], choiceNow());
  if ($('triage-count')) $('triage-count').textContent = `${picked.length} ${picked.length === 1 ? 'job' : 'jobs'}`;
  if ($('triage-start')) $('triage-start').textContent = `Check ${picked.length} ${picked.length === 1 ? 'job' : 'jobs'}`;
  if ($('triage-start')) $('triage-start').disabled = picked.length === 0 || running;
}

/**
 * Runs the checks on the picked jobs, one at a time, through `read(job)` (PR C's hidden-browser read). The bar moves per job; Cancel stops
 * before the next one. Resolves with how many were read.
 */
export async function runTriage(jobs, read) {
  if (running) return 0;
  running = true;
  cancelled = false;
  const bar = $('triage-bar'), words = $('triage-progress-text');
  $('triage-progress').hidden = false;
  let done = 0, seen = 0;
  try {
    for (const job of jobs) {
      if (cancelled) break;
      const result = await read(job).catch(() => null);
      if (result) { setRead(job.url, result); done += 1; }   // only a real read counts as read
      seen += 1;
      if (bar) bar.style.width = `${Math.round((seen / jobs.length) * 100)}%`;
      if (words) words.textContent = `${seen} of ${jobs.length}`;
    }
  } finally {
    running = false;
  }
  return done;
}

// The default read reads nothing (a window with no hidden browser behind it): the person is told so.
const notYetRead = async () => null;

/** Wires the popup once: `read(job)` is the form read in the hidden browser (null = nothing read), `cancel()` ends the read in flight, `rerender` redraws the list after a run, `toast(title, body, place, tone)` says how it ended. Takes the callbacks; a missing dialog wires nothing. */
export function wireTriage({read = notYetRead, cancel = () => {}, rerender = () => {}, toast = () => {}} = {}) {
  const dialog = $('triage-dialog');
  if (!dialog) return;
  $('triage-open').addEventListener('click', () => { paintCount(); dialog.showModal(); });
  $('triage-close').addEventListener('click', () => dialog.close());
  $('triage-by-best').addEventListener('click', () => { $('triage-by-best').setAttribute('aria-pressed', 'true'); $('triage-by-fit').setAttribute('aria-pressed', 'false'); paintCount(); });
  $('triage-by-fit').addEventListener('click', () => { $('triage-by-fit').setAttribute('aria-pressed', 'true'); $('triage-by-best').setAttribute('aria-pressed', 'false'); paintCount(); });
  $('triage-n').addEventListener('input', paintCount);
  $('triage-fit').addEventListener('input', paintCount);
  $('triage-cancel').addEventListener('click', () => { cancelled = true; cancel(); });
  $('triage-start').addEventListener('click', async () => {
    const jobs = pickForTriage(shared.allJobs || [], choiceNow());
    $('triage-start').disabled = true;
    const done = await runTriage(jobs, read);
    $('triage-progress').hidden = true;
    paintCount();
    rerender();
    toast(done ? 'Checked your jobs' : 'Nothing was checked', done ? `${done} of ${jobs.length} read. Each chip shows how it can apply.` : 'No form could be read. The hidden browser has to be downloaded first, and no application can be open.', null, done ? 'good' : 'info');
  });
  paintCount();
}

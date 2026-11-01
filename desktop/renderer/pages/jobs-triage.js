// Apply triage on the Jobs screen (spec 2026-10-30-apply-triage, PR B): the button, the popup (how many of the best new jobs), the progress with Cancel, and the chip on each job.
// The form read itself is the hidden browser's (lib/triage-reader.js); a job that was not read keeps its "Not checked" chip.
import {chip} from '../components.js';
import {$} from './core.js';
import {KEEP_TIMINGS, chipOf, estimateOf, pickForTriage} from '../apply-triage-pick.js';
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

// The seconds each real read took on this Mac (the last ten), so the popup's estimate learns from them; a window with no storage keeps them for this session only.
const TIMINGS_KEY = 'jobadabra.triage-seconds';
let timings = [];
try { timings = (JSON.parse(localStorage.getItem(TIMINGS_KEY) || '[]') || []).filter(Number.isFinite).slice(-KEEP_TIMINGS); } catch { timings = []; }
const rememberTiming = seconds => { timings = [...timings, seconds].slice(-KEEP_TIMINGS); try { localStorage.setItem(TIMINGS_KEY, JSON.stringify(timings)); } catch { /* no storage: this session only */ } };

let cancelled = false, running = false;   // one run at a time: a second Start while one runs does nothing

// The popup's one choice: the first N best matching jobs not checked before (owner, 30 Oct 2026), N from the one field.
const choiceNow = () => ({n: Math.max(1, Math.floor(Number($('triage-n')?.value) || 10)), isChecked: job => readOf(job.url) !== null});

function paintCount() {
  const picked = pickForTriage(shared.allJobs || [], choiceNow());
  const {text, measured} = estimateOf(picked.length, timings);
  const wanted = choiceNow().n, jobsWord = picked.length === 1 ? 'job' : 'jobs';
  const line = !picked.length ? 'Every job with a link is checked already.' : `${picked.length} ${jobsWord}${picked.length < wanted ? ' not checked yet' : ''}${text ? ` · ${text}${measured ? '' : ' (a guess until you check once)'}` : ''}`;
  if ($('triage-count')) $('triage-count').textContent = line;
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
      const started = Date.now();
      const result = await read(job).catch(() => null);
      if (result) { setRead(job.url, result); rememberTiming((Date.now() - started) / 1000); done += 1; }   // only a real read counts as read, and as a timing
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
  $('triage-n').addEventListener('input', paintCount);
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

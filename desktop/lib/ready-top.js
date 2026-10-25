// Fill now's pick (owner, 19 Oct 2026: "fills how many jobs... the highest ranking jobs that were not filled already"): the top jobs by fit, with what each still lacks
// (kit, tailored CV, cover letter) and what making it costs. Pure: the handler (lib/ready-handlers.js) prepares and sends; the card's popup shows it. Guard: test/ready-top.test.js.
import {DEFAULT_MIN_FIT} from './ready.js';

export const CHIPS = [1, 3, 5, 10];
export const DEFAULT_CHIP = 3;
// What one missing piece costs, in dollars: the kit is the app's own figure (a prep kit, about $0.04); the CV with its cover letter is an estimate until measured
// (the Tailor task reports the real total after each run, and so does the card).
export const KIT_USD = 0.04, CV_LETTER_USD = 0.06;

const open = job => ['unreviewed', 'saved'].includes(job.status) && !!job.url && !!job.code && !job.ineligible;
const best = (a, b) => (b.status === 'saved') - (a.status === 'saved') || (b.fit ?? -1) - (a.fit ?? -1);

// The best `limit` open jobs with fit >= minFit that no night holds already (skip: codes of forms on the server). -> [{code, title, company, fit, needsKit, needsCv, usd}]
export function pickTop(jobs, limit = Math.max(...CHIPS), {minFit = DEFAULT_MIN_FIT, skip = new Set()} = {}) {
  return jobs.filter(job => open(job) && (job.fit ?? -1) >= minFit && !skip.has(job.code)).sort(best).slice(0, limit).map(job => {
    const needsKit = !job.kit, needsCv = !job.tailored || !job.letter;
    return {code: job.code, title: job.title || '', company: job.company || '', fit: job.fit ?? null, needsKit, needsCv,
      usd: Math.round(((needsKit ? KIT_USD : 0) + (needsCv ? CV_LETTER_USD : 0)) * 100) / 100};
  });
}

// The popup's cost line for the first `count` of the pick: "3 jobs: 2 kits + 3 CVs with letters, about $0.26", or "3 jobs are ready: nothing to prepare".
export function costLine(picked, count, {showCost = false} = {}) {   // showCost: only on the user's own API key (ai/names.js costVisible)
  const list = picked.slice(0, count), kits = list.filter(job => job.needsKit).length, cvs = list.filter(job => job.needsCv).length;
  const total = Math.round(list.reduce((sum, job) => sum + job.usd, 0) * 100) / 100, jobsWord = `${list.length} job${list.length === 1 ? '' : 's'}`;
  if (!list.length) return 'No job is left to fill: every good match is on the server already.';
  if (!kits && !cvs) return `${jobsWord} ready: nothing to prepare, no AI cost.`;
  const parts = [kits && `${kits} kit${kits === 1 ? '' : 's'}`, cvs && `${cvs} CV${cvs === 1 ? '' : 's'} with letter${cvs === 1 ? '' : 's'}`].filter(Boolean);
  return `${jobsWord}: prepare ${parts.join(' + ')}${showCost ? `, about $${total.toFixed(2)} of AI` : ''}.`;
}

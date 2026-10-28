// Insight #6 of Profile → CV (spec docs/superpowers/specs/2026-10-28-insights-with-actions-design.md, PR 2): skills your target jobs ask for that only the Experience
// bank has. Counts, no AI call: the skills the AI already read from each posting (job.skills) against the bank's extra skills (experienceGet `extraSkills`).
// Free of the DOM so the tests can check it. Guarded by test/skill-entries.test.js.
import {matchesOnly} from './jobs-view.js';

export const SKILL_DOES = ['use_bank_skills'];
export const TARGET_FIT = 70;   // the app's "High fit" (jobs-view.js stats): a job worth tailoring a CV for
export const MAX_SKILLS = 3;    // the row names the few that matter most, not the whole bank
const ENDED = new Set(['Rejected', 'Withdrawn', 'No answer', 'Dismissed', 'Closed']);   // jobs-view.js OVER: nothing left to tailor for
const words = text => String(text || '').split(',').map(word => word.trim()).filter(Boolean);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** The target jobs: job matches scored 70+ that are not applied to and not over. */
export const targetJobs = jobs => matchesOnly(jobs || []).filter(job => job.fit >= TARGET_FIT && job.status !== 'applied' && !ENDED.has(job.stage || ''));

/**
 * The bank-only skills target jobs ask for, most asked first: [{skill, jobs}] with `jobs` how many target jobs list it. A skill already in the main CV, or already
 * added by the person, is not bank-only. At most MAX_SKILLS; [] when no job asks for one.
 */
export function bankSkills({jobs, extraSkills = '', mainSkills = '', added = []}) {
  const have = [...words(mainSkills), ...added.filter(item => item.kind === 'skill').map(item => item.text)];
  const bankOnly = words(extraSkills).filter(skill => !have.some(each => same(each, skill)));
  const targets = targetJobs(jobs);
  return bankOnly.map(skill => ({skill, jobs: targets.filter(job => (job.skills || []).some(each => same(String(each), skill))).length}))
    .filter(item => item.jobs > 0).sort((a, b) => b.jobs - a.jobs).slice(0, MAX_SKILLS);
}

/** The one row for Focus → Suggestions and the Jobs bar (pool shape, src/suggestions.py _entry); none when no job asks for a bank-only skill. */
export function skillEntries({jobs, extraSkills, mainSkills, added} = {}) {
  const found = bankSkills({jobs, extraSkills, mainSkills, added});
  if (!found.length) return [];
  const total = targetJobs(jobs).length;
  const names = found.map(item => item.skill);
  return [{kind: 'skills', key: `skills:${names.map(name => name.toLowerCase()).sort().join('+')}`, home: 'jobs', topic: 'cv', source: 'Your CV',
    title: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} only in your Experience bank`,
    short: `${names.length} CV skill${names.length === 1 ? '' : 's'} to use`,
    detail: found.map(item => `${item.skill}: ${item.jobs} of ${total} target jobs`).join(' · '),
    evidence: [], skills: names, blocking: false, answers: ['Not now'],
    actions: [{label: 'Use in my CVs', do: 'use_bank_skills', skills: names}]}];
}

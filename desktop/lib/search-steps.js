// Owns: the steps of one "Find jobs" run (the search task): the first run's order (jobs in seconds: a slice of fast feeds, 3 scored, then the rest), the usual
// order (job boards, then the employers' pages), and the employer finder (the scout) at the end when it is due, so one action grows the sources and crawls them.
// Guarded by: test/search-steps.test.js, test/app-scenarios.test.js. Spec: docs/superpowers/specs/2026-10-16-first-jobs-fast.md.
import * as claudeCode from './claude-code.js';
import {dailyArgs, SEARCH_BUDGET_S, deliveryReady, triggerEnv} from './pipeline-args.js';
import {run} from './pipeline-run.js';

const SCOUT_COOLDOWN_MS = 24 * 3600 * 1000;   // a press of Find jobs grows the sources at most once a day

// The employer finder is part of Find jobs: on the first run, and on a press when none ran in the last day. A schedule that has its own scout
// (Settings → How often) keeps it separate.
export function scoutDue(settings, trigger, now = Date.now(), force = false) {
  if (force) return true;   // "Find more employers" from the few-jobs help or the next-step advice
  if (trigger === 'schedule' || settings.cloud?.repo) return false;
  if (trigger === 'first' || !settings.lastScoutAt) return true;
  return now - Date.parse(settings.lastScoutAt) >= SCOUT_COOLDOWN_MS;
}

// A Find jobs press on a Mac that never searched is the first run (jobs in seconds), whoever pressed: the card, the header button, ⌘K.
export const searchTrigger = settings => (settings.lastSearchAt ? 'you' : 'first');

// One deadline for the whole press (owner, 26 Oct 2026: "A find jobs session should take at most 3min"; the 06:21 press took 269 s: the job
// boards' step 177 s with no clock, then the search's own 3 minutes). Every engine step gets the press's time (JOB_PILOTTO_SEARCH_AT) and counts
// from it (src/time_budget.py): the job boards' step ends at its share (src/sources/boards.py SHARE_S), the search at the press's end, minus
// the finder's share when it is due; the finder gets what is left. A step with no time left waits for the next search and says so.
export const SCOUT_SHARE_S = 45;   // the employer finder's seconds at the press's end, when it is due
const STEP_MIN_S = 20;             // fewer seconds left: the step waits for the next search (an engine step needs a few to start)

export async function searchSteps(storage, onLine, mode, trigger = 'you', exec = run, {employers = false, now = Date.now} = {}) {
  const ai = claudeCode.aiReady(storage.settings(), !!storage.secret('ANTHROPIC_API_KEY'), !!storage.secret('OPENAI_API_KEY'));
  const pressAt = now();
  const env = {...triggerEnv(trigger), JOB_PILOTTO_SEARCH_AT: String(pressAt / 1000)};
  const scout = scoutDue(storage.settings(), trigger, Date.now(), employers);
  const budget = SEARCH_BUDGET_S - (scout ? SCOUT_SHARE_S : 0);   // the search's end on the press's clock
  const spent = () => Math.floor((now() - pressAt) / 1000);
  const left = () => SEARCH_BUDGET_S - spent();
  const timeUp = what => onLine(`⏱ Time is up (${Math.floor(spent() / 60)} min ${String(spent() % 60).padStart(2, '0')} s) for ${what}: it waits for the next search`);
  const discover = async () => {
    if (budget - spent() < STEP_MIN_S) return timeUp('job boards');
    onLine('Searching job boards…');
    await exec(storage, ['src', 'discover', '--pages', '5', '--max-companies', '40', '--budget', String(budget)], onLine, env);
  };
  let code;
  let result;
  if (trigger === 'first' && ai) {
    // The first run: jobs in seconds. The engine reads a slice of fast feeds and scores 3 jobs first (src/first_jobs.py), then does the full search;
    // the job boards come after it, and the jobs they find are scored by a light run (mode today), so nothing in front of the first job waits for them.
    onLine('Finding your first jobs…');
    ({code, result} = await exec(storage, dailyArgs(storage, {mode, firstJobs: true, budget}), onLine, env));
    await discover();
    if (budget - spent() < STEP_MIN_S) timeUp('scoring the job boards\' jobs');
    else await exec(storage, dailyArgs(storage, {mode: 'today', budget}), onLine, env);
  } else {
    await discover();
    onLine('Checking employer career pages' + (ai ? ', then reading and scoring new jobs…' : '…'));
    ({code, result} = await exec(storage, dailyArgs(storage, {mode, budget}), onLine, env));
  }
  if (scout && left() < STEP_MIN_S) timeUp('finding more employers');   // still due: the next press runs it
  else if (scout) {
    onLine('Growing your sources: finding more employers…');
    storage.saveSettings({lastScoutAt: new Date().toISOString()});
    await exec(storage, ['src', 'scout', ...(deliveryReady(storage) ? ['--send'] : []), '--log-run', '--budget', String(left())], onLine, env);
  }
  return {code, result};
}

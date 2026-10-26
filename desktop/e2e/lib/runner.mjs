// Runs a suite's steps: names, timings, a screenshot on the first failure, a summary, an exit code. Steps that need a secret that is not there are skipped, loudly.
import path from 'node:path';
import {ARTIFACTS} from './app.mjs';
import {refusalNote} from './ai-refused.mjs';
import {isEnvironment, RETRY_WAIT_MS} from './environment.mjs';
import {faultCheck, NEVER_FIRED, neverFiredNote} from './faults.mjs';
import {causeOf, sharedCauseLines} from './step-cause.mjs';

// keepGoing (a suite's `export const keepGoing = true`): a failed step is recorded and the next one runs, so one failure never hides the rest of the suite
// (5 Oct 2026: one outdated step hid fifteen, twice). A step marked `critical` (the setup the others need) still stops the suite.
// A step that never ends (6 Oct 2026: activityfailures sat 25 min after its first step, killed by the job's timeout with no screenshot and no app log: a call into the
// app that never answered). Every step gets a limit (limitMs, default 8 min: twice the longest step of the 6 Oct gate, 226 s); past it the step fails like any other, saving the
// screenshot and logs, with which side of the app still answers in the message.
export const STEP_LIMIT_MS = Number(process.env.E2E_STEP_LIMIT_MS) || 8 * 60000;
const answers = (promise, ms = 5000) => Promise.race([promise.then(() => true, () => false), new Promise(done => setTimeout(() => done(false), ms))]);
export async function hangReport(session) {
  if (!session) return 'no app session';
  const [window, main] = await Promise.all([answers(session.page?.evaluate(() => 1) ?? Promise.reject()), answers(session.app?.evaluate(() => 1) ?? Promise.reject())]);
  return `the window ${window ? 'answers' : 'does NOT answer'}, the main process ${main ? 'answers' : 'does NOT answer'}`;
}
export function withLimit(promise, ms, name, getSession = () => null, budget = 0) {   // budget: set when the suite's budget, not the step's own limit, is what cuts it
  let timer;
  const limit = new Promise((_, fail) => { timer = setTimeout(async () => fail(new Error(budget
    ? `the suite's ${Math.round(budget / 60000)}-minute budget ran out during this step (the suite is too long: split it): ${await hangReport(getSession())}`
    : `the step did not finish within ${Math.round(ms / 60000)} min (it hung): ${await hangReport(getSession())}`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// E2E_STEPS=<words> runs only the steps whose name contains one; `stepNeeds` (a suite's export: {'step name words': ['words of a step it needs', ...]}) adds the
// steps a chosen one depends on, transitively (6 Oct 2026: a filtered run lacked the earlier step that opened Settings, made the second run, set the proxy up...).
export function wantedWords(words, stepNeeds = {}) {
  const wanted = new Set(words.map(word => word.toLowerCase()));
  for (let grew = true; grew;) {
    grew = false;
    for (const [step, needs] of Object.entries(stepNeeds)) {
      if (![...wanted].some(word => step.toLowerCase().includes(word) || word.includes(step.toLowerCase()))) continue;   // a word of it, or a full step name (E2E_STEP_NAMES) that contains it
      for (const need of needs) if (!wanted.has(need.toLowerCase())) { wanted.add(need.toLowerCase()); grew = true; }
    }
  }
  return [...wanted];
}

// E2E_STEP_NAMES (a JSON list of exact step names): the steps a pull request's changed lines reach (pr-suites.mjs, from the per-step coverage map), plus their
// stepNeeds and the critical setup. "(setup)" alone: only the critical setup (the change ran only at launch or between steps). A picked name that matches no step
// (renamed since the map was recorded) fails the suite, never a quiet green: e2e.yml's second try then runs the whole suite.
export function pickedNames(env = process.env) {
  try { const names = JSON.parse(env.E2E_STEP_NAMES || '[]'); return Array.isArray(names) ? names.map(name => String(name).toLowerCase()) : []; } catch { return []; }
}
export const PICK_SETUP = '(setup)';

// A whole suite has a budget too (owner, 6 Oct 2026: no suite over 5-7 minutes). Past it, the steps left are recorded as not run and the suite fails, naming its
// slowest steps; a running step is cut at the budget's end. A suite that truly needs more says so (`export const budgetMinutes`): a manual suite, or the recorded replay (it grows a case at a time; sharded in page-cases.yml and, by its `shards`, in the gates: lib/suite-shards.mjs).
export const SUITE_BUDGET_MS = Number(process.env.E2E_SUITE_BUDGET_MS) || 7 * 60000;
// A suite's own budget (`export const budgetMinutes`), else the default: the runner (lib/context.mjs) and the force-stop (suite.mjs) both read it here, and the CI step and job limits must stay above it + 3 min.
export const budgetMsOf = suite => (suite?.budgetMinutes ? suite.budgetMinutes * 60000 : SUITE_BUDGET_MS);
export const slowest = (results, count = 5) => results.filter(result => result.seconds).sort((a, b) => b.seconds - a.seconds).slice(0, count).map(result => `${result.name.slice(0, 70)} (${Math.round(result.seconds)} s)`);

// The screenshot a failed step leaves (without .png); the HTML report attaches it.
export const shotName = name => `failed-${name.replace(/\W+/g, '-').slice(0, 60)}`;

// faultTally: () => the fakes' {armed, failed} counters (lib/faults.mjs), to check that a step's fault fired.
// report (the Playwright HTML report, lib/suite-main.mjs): each step runs as a Playwright step, with a screenshot of the window when it ends (the failure's, if it failed).
const pictureOf = async session => (session?.page ? Promise.race([session.page.screenshot().catch(() => null), new Promise(done => setTimeout(() => done(null), 10000))]) : null);
// stepNeeds null: the suite declares none, so its steps may build on every earlier one (quality's checks read the rows its Jobs check wrote, after the step that loads
// the golden postings): a picked run then runs every step up to the last picked one and skips only the rest (#2108, 26 Oct 2026). Declared (even {}): the precise pick.
export function createRunner(getSession, {keepGoing = false, budgetMs = SUITE_BUDGET_MS, stepNeeds = null, faultTally = null, report = null} = {}) {
  const results = [], suiteStarted = Date.now(), picked = pickedNames(), found = new Set();
  const buildsOn = stepNeeds == null && picked.length > 0 && !String(process.env.E2E_STEPS || '').trim();
  const allFound = () => picked.every(name => name === PICK_SETUP || found.has(name));
  let overBudget = false;
  // elsewhere: the suite leaves this step to another slice of itself (step-sharded apply/applyflows): a picked name is still found, so the slice without it is not red.
  async function run(name, rawFn, {needs = [], faults = false, critical = false, limitMs = STEP_LIMIT_MS, elsewhere = false} = {}) {
    if (elsewhere) { if (picked.includes(name.toLowerCase())) found.add(name.toLowerCase()); return; }
    const left = budgetMs - (Date.now() - suiteStarted);
    if (left <= 0) {
      if (!overBudget) console.log(`✗ the suite is over its ${Math.round(budgetMs / 60000)}-minute budget; slowest steps: ${slowest(results).join('; ')}`);
      overBudget = true;
      results.push({name, status: 'failed', note: `not run: the suite was over its ${Math.round(budgetMs / 60000)}-minute budget`, budget: true});
      await report?.skipStep(`${name} (not run: over the suite's budget)`).catch(() => {});
      return;
    }
    const fn = () => withLimit(Promise.resolve().then(rawFn), Math.min(limitMs, left), name, getSession, left < limitMs ? budgetMs : 0);   // faults: the step breaks things on purpose, so a broken answer is the product's to handle: never retried, never "environment"
    // E2E_STEPS=tailor,seeded runs only the steps whose name contains one of these words (and the critical setup): a quick way to re-run one step of a long suite.
    const only = wantedWords([...(process.env.E2E_STEPS || '').split(',').map(word => word.trim()).filter(Boolean), ...picked], stepNeeds || {});
    const doneBefore = allFound();
    if (picked.includes(name.toLowerCase())) found.add(name.toLowerCase());
    if (buildsOn ? !critical && doneBefore : only.length && !critical && !only.some(word => name.toLowerCase().includes(word))) return;
    const missing = needs.filter(item => !item.value);
    if (missing.length) { results.push({name, status: 'skipped'}); console.log(`- ${name}: skipped (needs ${missing.map(item => item.name).join(', ')})`); await report?.skipStep(name).catch(() => {}); return; }
    const started = Date.now(), before = faultTally?.();
    const unfired = () => faultCheck(before, faultTally?.(), {faults});
    let retried = '';
    await getSession()?.coverageMark?.(name);   // what ran since the last step is setup, not this step's (lib/coverage.mjs)
    const attempt = async () => {
      await getSession()?.traceGroup?.(name);   // the step's actions sit under its name in the trace (lib/app.mjs), and in the report's step
      try {
        try { await fn(); } catch (error) {
          // The environment answered badly (an HTML error page, a dropped connection): one more try before it counts (#266).
          if (faults || !isEnvironment(error.message)) throw error;
          retried = String(error.message).slice(0, 200);
          console.log(`↻ ${name}: the environment failed (${retried.slice(0, 120)}), trying once more`);
          await new Promise(done => setTimeout(done, RETRY_WAIT_MS));
          await fn();
        }
      } catch (error) {
        await getSession()?.shot(shotName(name));   // inside the step, so the report shows it there
        if (report) await report.attach('screenshot (failed)', {path: path.join(ARTIFACTS, `${shotName(name)}.png`), contentType: 'image/png'}).catch(() => {});
        throw error;
      }
      const picture = report && await pictureOf(getSession());
      if (picture) await report.attach('screenshot', {body: picture, contentType: 'image/png'}).catch(() => {});
    };
    try {
      await (report ? report.step(name, attempt) : attempt());
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const vacuous = unfired();
      results.push({name, status: 'passed', seconds, ...(retried ? {retried} : {}), ...(vacuous ? {faultNeverFired: true} : {})});
      console.log(`✓ ${name} (${seconds}s)${retried ? ' after one retry' : ''}${vacuous ? ` ⚠ passed, but ${NEVER_FIRED}: it may test nothing` : ''}`);
    } catch (error) {
      await getSession()?.keepLogs();   // the app's and the engine's own logs: a screenshot says "nothing new", the log says why
      const base = unfired() ? `${error.message} ${neverFiredNote}` : error.message;
      // The AI refusing every call (a spend limit) is the cause, whatever symptom the step saw: say it first, and it is the test environment's failure, never a product bug (lib/ai-refused.mjs).
      const refused = faults ? '' : refusalNote(getSession()?.profile);
      const note = refused ? `${refused}; the step then failed: ${base}` : base;
      results.push({name, status: 'failed', note, cause: causeOf(note), ...(refused || (!faults && isEnvironment(error.message)) ? {environment: true} : {}), ...(base !== error.message ? {faultNeverFired: true} : {})});
      console.log(`✗ ${name}: ${note}`);
      if (keepGoing && !critical) return;   // recorded: the suite still fails at the end, and the next step runs
      throw error;
    } finally { await getSession()?.coverageStep?.(name); await getSession()?.traceGroupEnd?.(); }
  }
  const summary = () => {
    const lost = picked.filter(name => name !== PICK_SETUP && !found.has(name));
    if (lost.length) { results.push({name: 'steps picked for this PR', status: 'failed', note: `no step is named ${lost.map(name => `"${name}"`).join(', ')} (renamed since the coverage map was recorded): the whole suite runs next`}); console.log(`✗ picked step(s) not found: ${lost.join('; ')}`); }
    else if (picked.length) console.log(`(ran only the ${picked.filter(name => name !== PICK_SETUP).length} step(s) this PR's changes reach, their needs and the setup: E2E_STEP_NAMES)`);
    const count = status => results.filter(result => result.status === status).length;
    console.log(`\n${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped`);
    for (const line of sharedCauseLines(results)) console.log(line);   // gate G3: six reds on one locator read as one cause, not six bugs
    return count('failed') ? 1 : 0;
  };
  return {run, results, summary, ARTIFACTS};
}

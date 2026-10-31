// Runs a suite's steps: names, timings, a screenshot on the first failure, a summary, an exit code. Steps that need a secret that is not there are skipped, loudly.
// Job: wait on state
import path from 'node:path';
import {ARTIFACTS, DESKTOP} from './app.mjs';
import {ensureStaged} from './ensure-staged.mjs';
import {refusalNote} from './ai-refused.mjs';
import {capMessage, skipStepForCap, takeCapped} from './ai-cap.mjs';
import {isEnvironment, RETRY_WAIT_MS} from './environment.mjs';
import {faultCheck, NEVER_FIRED, neverFiredNote} from './faults.mjs';
import {codeLine} from './artifacts.mjs';
import {causeOf, sharedCauseLines} from './step-cause.mjs';
import {providerLine} from './ai-provider.mjs';
import {stepClock} from './wait-on-state.mjs';
import {backboneSuite} from './hang-caps.mjs';

// keepGoing (a suite's `export const keepGoing = true`): a failed step is recorded and the next one runs, so one failure never hides the rest of the suite
// (5 Oct 2026: one outdated step hid fifteen, twice). A step marked `critical` (the setup the others need) still stops the suite.
// A step that never ends (6 Oct 2026: activityfailures sat 25 min after its first step, killed by the job's timeout with no screenshot and no app log: a call into the
// app that never answered). Backbone steps require named measured caps. Tolerant suites keep the 8-minute default.
// Past its cap the step fails like any other, saving screenshots and logs with which side of the app still answers in the message.
export const STEP_LIMIT_MS = Number(process.env.E2E_STEP_LIMIT_MS) || 8 * 60000;
const answers = (promise, ms = 5000) => Promise.race([promise.then(() => true, () => false), new Promise(done => setTimeout(() => done(false), ms))]);
export async function hangReport(session) {
  if (!session) return 'no app session';
  const [window, main] = await Promise.all([answers(session.page?.evaluate(() => 1) ?? Promise.reject()), answers(session.app?.evaluate(() => 1) ?? Promise.reject())]);
  return `the window ${window ? 'answers' : 'does NOT answer'}, the main process ${main ? 'answers' : 'does NOT answer'}`;
}
/** Bound a step. `hangError(ms)` (optional, may be async) gives the step's evidence as text; the runner alone says the step was cut off, by its own limit or the suite's budget. */
export function withLimit(promise, ms, name, getSession = () => null, budget = 0, hangError) {   // budget: set when the suite's budget, not the step's own limit, is what cuts it
  let timer;
  stepClock(ms);   // the step's own waits run until this cap, never to a shorter one of their own (lib/wait-on-state.mjs)
  // Why (#2501; 30 Oct 2026, owner redesign; g2: hangError may be async, so a step whose waits carry no clock can read the hidden browser when its cap fires): a step keeps its evidence; only cap errors are marked so opted-in owned steps stop without retrying abandoned work. Other errors stay unchanged.
  // Why (31 Oct 2026, owner: "why it's flaky? Or it's a product bug?"): a step's own hang words ("the chip step hung within 129.72 s") hid that the suite's budget cut it, and the grey rule
  // read a wrong value; the runner owns the cut-off verdict (timing), the step only adds what it saw (test/step-limit.test.mjs).
  const limit = new Promise((_, fail) => { timer = setTimeout(async () => {
    const cut = budget ? `the suite's ${Math.round(budget / 60000)}-minute budget ran out during this step (the suite is too long: split it)`
      : `the step did not finish within ${ms < 10 * 60000 ? `${ms / 1000} s` : `${Math.round(ms / 60000)} min`} (it hung)`;
    const error = new Error(`${cut}: ${hangError ? await hangError(ms) : await hangReport(getSession())}`); error.stepHang = true; fail(error); }, ms); });
  return Promise.race([promise, limit]).finally(() => { clearTimeout(timer); stepClock(null); });
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
// (renamed since the map was recorded) fails the suite, never a quiet green: e2e.yml's picked-step fallback (red-steps.mjs --renamed-only) then runs the whole suite once.
export function pickedNames(env = process.env) {
  try { const names = JSON.parse(env.E2E_STEP_NAMES || '[]'); return Array.isArray(names) ? names.map(name => String(name).toLowerCase()) : []; } catch { return []; }
}
export const PICK_SETUP = '(setup)';

// A whole suite has a budget too (owner, 6 Oct 2026: no suite over 5-7 minutes). Past it, the steps left are recorded as not run and the suite fails, naming its
// slowest steps; a running step is cut at the budget's end. A suite that truly needs more says so (`export const budgetMinutes`): a manual suite, or the recorded replay (it grows a case at a time; sharded in page-cases.yml and, by its `shards`, in the gates: lib/suite-shards.mjs).
export const SUITE_BUDGET_MS = Number(process.env.E2E_SUITE_BUDGET_MS) || 7 * 60000;
// Why (31 Oct 2026, owner's pick; main run 41146558456): a suite without an aggregate had no stop of its own, so a slow Mac runner hit the workflow's 15-minute
// step limit and GitHub killed it with no record: nothing could say it was timing. It stops TRY_MARGIN_MS before that limit instead,
// through the budget cut below, whose records read as timing. The limit has one owner: the workflow step's timeout-minutes, mirrored in E2E_TRY_MINUTES
// (tests/test_e2e_try_minutes.py); a local run has none.
// Why (31 Oct 2026, Gitar on #2654): the failure records are written after close-down, so the margin holds its whole cap (suite-main.mjs TEARDOWN_STOP_MS, 3 min)
// plus a minute for start-up and the writes; a test ties the two. Not imported from suite-main: that would load app.mjs into every suite-main importer.
export const TRY_MARGIN_MS = 4 * 60000;
/** A suite can leave the aggregate budget (then only the CI try's limit, less the margin, cuts it); otherwise its own budget or the default applies. Takes the suite's exports and env. */
export const budgetMsOf = (suite, env = process.env) => (suite?.aggregateBudget === false
  ? (Number(env.E2E_TRY_MINUTES) > 0 ? Number(env.E2E_TRY_MINUTES) * 60000 - TRY_MARGIN_MS : Infinity)
  : suite?.budgetMinutes ? suite.budgetMinutes * 60000 : SUITE_BUDGET_MS);
/** Budgeted suites keep budget plus three minutes; suites without an aggregate have no start-time stop. */
export const stopMsOf = suite => (suite?.aggregateBudget === false ? null : budgetMsOf(suite) + 3 * 60000);
/** Decide the start-time stop from the suite exports; shared code must be staged before loading, and load errors must never become a default budget. */
export async function suiteStopMs(name, {stage = () => ensureStaged(DESKTOP), load = name => import(`../suites/${name}.mjs`)} = {}) {
  // Why (30 Oct 2026, beta 41121393681): a clean CI checkout hid apply's no-aggregate export behind a missing shared module and armed a false 10-minute stop.
  await stage();
  try { return stopMsOf(await load(name)); }
  catch (error) { throw new Error(`Cannot load the ${name} suite: ${error.message}`, {cause: error}); }
}
export const slowest = (results, count = 5) => results.filter(result => result.seconds).sort((a, b) => b.seconds - a.seconds).slice(0, count).map(result => `${result.name.slice(0, 70)} (${Math.round(result.seconds)} s)`);

// The screenshot a failed step leaves (without .png); the HTML report attaches it.
export const shotName = name => `failed-${name.replace(/\W+/g, '-').slice(0, 60)}`;

// faultTally: () => the fakes' {armed, failed} counters (lib/faults.mjs), to check that a step's fault fired.
// report (the Playwright HTML report, lib/suite-main.mjs): each step runs as a Playwright step, with a screenshot of the window when it ends (the failure's, if it failed).
const pictureOf = async session => (session?.page ? Promise.race([session.page.screenshot().catch(() => null), new Promise(done => setTimeout(() => done(null), 10000))]) : null);
// stepNeeds null: the suite declares none, so its steps may build on every earlier one (quality's checks read the rows its Jobs check wrote, after the step that loads
// the golden postings): a picked run then runs every step up to the last picked one and skips only the rest (#2108, 26 Oct 2026). Declared (even {}): the precise pick.
/** Resolve an exact cap or its longest prefix; backbone steps may never use the tolerant default. */
export const hangLimitMs = (hangCaps, name, suite = '', cadence = '') => {
  const prefix = Object.keys(hangCaps).filter(head => head && name.startsWith(head)).sort((a, b) => b.length - a.length)[0];
  const seconds = hangCaps[name] ?? (prefix === undefined ? undefined : hangCaps[prefix]);
  if (seconds !== undefined && Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  if (backboneSuite(suite, cadence)) throw new Error(`${suite}: no hang cap for "${name}". Measure with tools/e2e-step-timings.mjs --suite ${suite} --caps, or add 3 x its PR run time (30 s floor) with Why "provisional: regenerate after 5 main runs".`);
  return hangCaps[''] === undefined ? STEP_LIMIT_MS : hangCaps[''] * 1000;
};
// An opted-in owned step must stop the suite after a hang; its raw promise cannot be cancelled.
const ownedHang = (error, stopOnHang) => stopOnHang && error.stepHang;

/** Run state checks with named hang caps; owned steps may stop progression on a hang. */
export function createRunner(getSession, {suite = '', cadence = '', keepGoing = false, budgetMs = SUITE_BUDGET_MS, hangCaps = {}, stepNeeds = null, faultTally = null, report = null, suspended = {}} = {}) {
  const results = [], suiteStarted = Date.now(), picked = pickedNames(), found = new Set();
  if (process.env.CI) console.log(providerLine(process.env, 'judges'));   // Why (#2416, Gitar): who decided the judges' provider is never a guess
  const buildsOn = stepNeeds == null && picked.length > 0 && !String(process.env.E2E_STEPS || '').trim();
  const allFound = () => picked.every(name => name === PICK_SETUP || found.has(name));
  let overBudget = false;
  // elsewhere: the suite leaves this step to another slice of itself (step-sharded apply/applyflows): a picked name is still found, so the slice without it is not red.
  // clean-code-ok: Why (#2501; 30 Oct 2026, owner redesign): old function; reuse its cap and opt-in stopOnHang while preserving other suites' retry and keep-going defaults.
  async function run(name, rawFn, {needs = [], faults = false, critical = false, stopOnHang = false, limitMs, hangError, elsewhere = false} = {}) {
    if (elsewhere) { if (picked.includes(name.toLowerCase())) found.add(name.toLowerCase()); return; }
    const left = budgetMs - (Date.now() - suiteStarted);
    if (left <= 0) {
      if (!overBudget) console.log(`✗ the suite is over its ${Math.round(budgetMs / 60000)}-minute budget; slowest steps: ${slowest(results).join('; ')}`);
      overBudget = true;
      results.push({name, status: 'failed', note: `not run: the suite was over its ${Math.round(budgetMs / 60000)}-minute budget`, budget: true});
      await report?.skipStep(`${name} (not run: over the suite's budget)`).catch(() => {});
      return;
    }
    let cap;
    const fn = () => withLimit(Promise.resolve().then(rawFn), Math.min(cap, left), name, getSession, left < cap ? budgetMs : 0, hangError);   // faults are never retried as environment noise
    // E2E_STEPS=tailor,seeded runs only the steps whose name contains one of these words (and the critical setup): a quick way to re-run one step of a long suite.
    const only = wantedWords([...(process.env.E2E_STEPS || '').split(',').map(word => word.trim()).filter(Boolean), ...picked], stepNeeds || {});
    const doneBefore = allFound();
    if (picked.includes(name.toLowerCase())) found.add(name.toLowerCase());
    if (buildsOn ? !critical && doneBefore : only.length && !critical && !only.some(word => name.toLowerCase().includes(word))) return;
    const missing = needs.filter(item => !item.value);
    if (missing.length) { results.push({name, status: 'skipped'}); console.log(`- ${name}: skipped (needs ${missing.map(item => item.name).join(', ')})`); await report?.skipStep(name).catch(() => {}); return; }
    takeCapped();   // a cap refusal seen from here on belongs to this step
    const started = Date.now(), before = faultTally?.();
    const unfired = () => faultCheck(before, faultTally?.(), {faults});
    let retried = '';
    await getSession()?.coverageMark?.(name);   // what ran since the last step is setup, not this step's (lib/coverage.mjs)
    const attempt = async () => {
      await getSession()?.traceGroup?.(name);   // the step's actions sit under its name in the trace (lib/app.mjs), and in the report's step
      try {
        try { await fn(); } catch (error) {
          // The environment answered badly (an HTML error page, a dropped connection): one more try before it counts (#266).
          if (faults || ownedHang(error, stopOnHang) || !isEnvironment(error.message)) throw error;
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
      const named = hangLimitMs(hangCaps, name, suite, cadence);
      cap = backboneSuite(suite, cadence) ? Math.min(limitMs ?? named, named) : limitMs ?? named;
      await (report ? report.step(name, attempt) : attempt());
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const vacuous = unfired();
      results.push({name, status: 'passed', seconds, ...(suspended[name] ? {suspended: true} : {}), ...(retried ? {retried} : {}), ...(vacuous ? {faultNeverFired: true} : {})});
      console.log(`✓ ${name} (${seconds}s)${retried ? ' after one retry' : ''}${vacuous ? ` ⚠ passed, but ${NEVER_FIRED}: it may test nothing` : ''}`);
    } catch (error) {
      // Why (31 Oct 2026, owner): "the fact that AI credit finished should not stop a beta from being green. It should just raise an alert. And that's it." Every capped step is skipped, including release gates.
      const capped = takeCapped();
      if (capped) {
        results.push({name, status: 'skipped', aiCapped: true, note: capMessage(capped.neurons, process.env, capped.why)});
        skipStepForCap(name, capped);
        await report?.skipStep(`${name} (AI capped)`).catch(() => {});
        return;
      }
      await getSession()?.keepLogs();   // the app's and the engine's own logs: a screenshot says "nothing new", the log says why
      const base = unfired() ? `${error.message} ${neverFiredNote}` : error.message;
      // The AI refusing every call (a spend limit) is the cause, whatever symptom the step saw: say it first, and it is the test environment's failure, never a product bug (lib/ai-refused.mjs).
      const refused = faults ? '' : refusalNote(getSession()?.profile);
      const note = refused ? `${refused}; the step then failed: ${base}` : base;
      const where = codeLine(error);
      // Why (31 Oct 2026, owner: "Means its flaky"; spec row 33): a step the lane registry suspended (flaky: red on code unchanged since it passed) runs and shows its result, but never fails the job.
      // An owned step cut off by its hang cap leaves work running that the next steps cannot trust, so it ends the suite quietly instead (suite-main.mjs reads suspendedStop).
      if (suspended[name]) {
        results.push({name, status: 'suspended', note, cause: causeOf(note), issue: suspended[name].issue, ...(where ? {where} : {})});
        console.log(`⚠ ${name}: suspended step (flaky, ${suspended[name].issue || 'owner issue'}), not blocking: ${note}${where ? ` (at ${where})` : ''}`);
        // Why (#2719, 31 Oct 2026, Gitar): a step that fails because the suspended one before it left the app closed is that step's flake, not its own; end the suite there.
        if (ownedHang(error, stopOnHang)) throw Object.assign(error, {suspendedStop: true, stoppedBecause: 'hung'});
        if (getSession()?.page?.isClosed?.()) throw Object.assign(error, {suspendedStop: true, stoppedBecause: 'left the app closed'});
        return;
      }
      results.push({name, status: 'failed', note, cause: causeOf(note), ...(where ? {where} : {}), ...(refused || (!faults && isEnvironment(error.message)) ? {environment: true} : {}), ...(base !== error.message ? {faultNeverFired: true} : {})});
      console.log(`✗ ${name}: ${note}${where ? ` (at ${where})` : ''}`);
      if (keepGoing && !critical && !ownedHang(error, stopOnHang)) return;   // recorded: the suite still fails at the end, and the next step runs
      throw error;
    } finally { await getSession()?.coverageStep?.(name); await getSession()?.traceGroupEnd?.(); }
  }
  const summary = () => {
    const lost = picked.filter(name => name !== PICK_SETUP && !found.has(name));
    if (lost.length) { results.push({name: 'steps picked for this PR', status: 'failed', note: `no step is named ${lost.map(name => `"${name}"`).join(', ')} (renamed since the coverage map was recorded): the whole suite runs next`}); console.log(`✗ picked step(s) not found: ${lost.join('; ')}`); }
    else if (picked.length) console.log(`(ran only the ${picked.filter(name => name !== PICK_SETUP).length} step(s) this PR's changes reach, their needs and the setup: E2E_STEP_NAMES)`);
    const count = status => results.filter(result => result.status === status).length;
    console.log(`\n${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped${count('suspended') ? `, ${count('suspended')} suspended (flaky, not blocking)` : ''}`);
    for (const line of sharedCauseLines(results)) console.log(line);   // gate G3: six reds on one locator read as one cause, not six bugs
    return count('failed') ? 1 : 0;
  };
  return {run, results, summary, ARTIFACTS};
}

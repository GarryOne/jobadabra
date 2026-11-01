/* global window */
// Shared by the apply suite's hold-a-job steps (restart, Stop): start one fixture job and wait on the app's state with the step's hang cap as the only clock.
// Job: wait on state
import {backgroundOf, describeHidden, evaluateOn, hiddenTargets, withFormJudge} from './background-proof.mjs';
import {appLogLines} from './app-log.mjs';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';

const applyLines = profile => { try { return appLogLines(profile).filter(line => /\[apply\]/.test(line)).slice(-4).map(line => line.slice(0, 220)).join(' // '); } catch { return '(app log unreadable)'; } };

/** What a step that did not get its state reports: what it waited for and last read, the app's apply lines and the hidden browser's tabs. `seen` is read when it is needed. */
const describe = async (ctx, seen) => `${seen.what} (last read: ${JSON.stringify(seen.state)}) | ${applyLines(ctx.profile)} | ${await describeHidden(ctx.profile)}`;
/** The step's evidence for the runner's hang report (hangError); the runner says it was cut off (lib/runner.mjs withLimit). */
export const hangOf = (ctx, seen) => () => describe(ctx, seen);

/** Waits until `read()` gives a value `accepts` takes, for as long as the step's hang cap leaves (lib/wait-on-state.mjs stepTimeLeft: no clock of its own); -> that value, or throws what `seen` says. */
export const waitOn = async (ctx, seen, read, accepts) => {
  const {value} = await pollUntil(read, accepts, {capMs: stepTimeLeft(), log: () => {}});
  if (!accepts(value)) throw new Error(await describe(ctx, seen));
  return value;
};

/** Saves `mode` (fill, or auto with its confirmation and `waitMin`) and starts the one seeded fixture job; `canned` is the AI stand-in (default: the form judge on top of the current one). Throws the app's refusal. */
export async function startJob(ctx, {form, seed, mode, waitMin, canned = withFormJudge(ctx.proxy.canned(), 'Submit Application')}) {
  if (mode === 'auto' && (!Number.isFinite(waitMin) || waitMin < 0)) throw new Error('Auto startJob requires an explicit nonnegative waitMin');
  const {page, proxy} = ctx;
  proxy.setCanned(canned);
  await seed(form);
  const chosenAt = new Date().toISOString();
  await page.evaluate(apply => window.pilot.saveSettings({apply}), mode === 'auto' ? {mode, chosenAt, autoConfirmedAt: chosenAt, auto: {waitMin}} : {mode, chosenAt});
  const started = await page.evaluate(() => window.pilot.apply({n: 1, mode: 'settings'}));
  if (started?.ok === false) throw new Error(`the app refused to start ${mode}: ${started.error}`);
}

/** The main-process clock bridge: Node's inspector cannot use dynamic import, so require the app's already loaded synchronous ESM module. */
export function moveAppWaitClock(_electron, {module, dueAt}) {
  const require = process.getBuiltinModule('module').createRequire(module);
  const clock = require(process.getBuiltinModule('url').fileURLToPath(module));
  return clock.moveBackgroundWaitClock(Math.max(clock.backgroundWaitNow(), dueAt) + 1);
}

/** Ask the owned service worker to complete a fresh poll; a missing worker or missing acknowledgement is failed evidence. */
export async function pollOwnedBackground(profile, {targets = hiddenTargets, evaluate = evaluateOn} = {}) {
  const all = await targets(profile), worker = all.find(target => target.type === 'service_worker');
  if (!worker) throw new Error(`no owned service worker for the due-time poll (targets: ${all.map(target => `${target.type} ${String(target.url).slice(0, 60)}`).join(' | ') || 'none'})`);
  const acknowledged = await evaluate(worker.webSocketDebuggerUrl, 'globalThis.__jobPilottoBackgroundSessions?.poll()', {strict: true});
  if (acknowledged !== true) {
    // Why (1 Nov 2026, apply-3of3 41264415439 + 41264558340, no cause provable): the reply was empty with no error and no /extension/background-apply request reached the app, so the message
    // says what was asked: the reply, every service worker target and whether each one has the poll's global, instead of a guess at a cold or a stale worker.
    const workers = all.filter(target => target.type === 'service_worker');
    const has = await Promise.all(workers.map(async target => `${String(target.url).slice(0, 70)} has the poll: ${await evaluate(target.webSocketDebuggerUrl, "typeof globalThis.__jobPilottoBackgroundSessions?.poll === 'function'").catch(error => `unreadable (${error.message})`)}`));
    throw new Error(`the owned extension poll did not acknowledge completion (reply: ${JSON.stringify(acknowledged ?? null)}; asked ${String(worker.url).slice(0, 70)}; service workers: ${has.join(' | ')})`);
  }
  return true;
}

/** Move the isolated app past this job's due time, then ask the extension's ordinary alarm poll to read it; wait for the app's fresh decision, never an alarm period. */
export async function advancePastDue(ctx, form, seen, {state, reason}) {
  const held = await backgroundOf(ctx.page, form.url);
  if (!held?.dueAt) throw new Error('the held job has no due time to advance past');
  const at = await ctx.app.evaluate(moveAppWaitClock, {module: new URL('../../lib/background-apply-clock.js', import.meta.url).href, dueAt: held.dueAt});
  seen.what = `the app never decided ${state}/${reason} after the moved due time`;
  return waitOn(ctx, seen, async () => {
    // The alarm normally invokes this same poll. Trigger it directly in the owned worker so Chrome's 30-second heartbeat is not a second test clock.
    await pollOwnedBackground(ctx.profile);
    return (seen.state = await backgroundOf(ctx.page, form.url));
  }, record => record?.waitDecision?.via === 'extension' && record.waitDecision.at >= at && record.waitDecision.state === state && record.waitDecision.reason === reason);
}

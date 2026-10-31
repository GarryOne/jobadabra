/* global window */
// Shared by the apply suite's hold-a-job steps (restart, Stop): start one fixture job and wait on the app's state with the step's hang cap as the only clock.
// Job: wait on state
import {describeHidden, withFormJudge} from './background-proof.mjs';
import {appLogLines} from './app-log.mjs';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';
import {REPORT_PERIOD_MINUTES} from '../../../extension/report-alarm.js';

const applyLines = profile => { try { return appLogLines(profile).filter(line => /\[apply\]/.test(line)).slice(-4).map(line => line.slice(0, 220)).join(' // '); } catch { return '(app log unreadable)'; } };

// A press waits for the extension's next report alarm (extension/report-alarm.js): one period after the app's own due time is when it would come, a second is the margin for the app to act on it.
export const WATCH_PAST_DUE_MS = 2 * REPORT_PERIOD_MINUTES * 60 * 1000;

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
export async function startJob(ctx, {form, seed, mode, waitMin = 1, canned = withFormJudge(ctx.proxy.canned(), 'Submit Application')}) {
  const {page, proxy} = ctx;
  proxy.setCanned(canned);
  await seed(form);
  const chosenAt = new Date().toISOString();
  await page.evaluate(apply => window.pilot.saveSettings({apply}), mode === 'auto' ? {mode, chosenAt, autoConfirmedAt: chosenAt, auto: {waitMin}} : {mode, chosenAt});
  const started = await page.evaluate(() => window.pilot.apply({n: 1, mode: 'settings'}));
  if (started?.ok === false) throw new Error(`the app refused to start ${mode}: ${started.error}`);
}

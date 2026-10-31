/* global document */
// The person's Stop on the page panel, pressed the way a person presses it, then judged by the panel's own state; a failure names that state.
// Job: wait on state
// Why (31 Oct 2026, a8; PR #2746's harness run 41250657527, panel-theme-stop.test.mjs): "Stop halts a fill with the panel open" was red with only "Stop did not halt the fill", and the
// next try would have known no more. The press found the control by its class (`.stop-btn`), and the failure carried no state. The CI cause is still a hypothesis; the first red that
// carries this state is its evidence.
// Invariants: the control is found by role and name ("Stop", the one that is shown: the open panel's or the minimised pill's) at the moment of the press; the press is Playwright's trusted
// click, which waits until the control is visible, enabled, still and not covered; each state the Stop should change (STOP_STAGES) is read from the panel in a loop and waited for on its own, never one combined wait at the end (one event per action); the loops end at the caller's cap or the step's clock.
// Tests: test/panel-stop.test.mjs
import {pollUntil, stepTimeLeft, stepWait, waitCapNote} from './wait-on-state.mjs';

const HOST = '#jobpilotto-review-host';

/**
 * What the page's panel shows now, for the verdict and for a failure message.
 * Why: the panel exposes no role for "stopped", so its own state classes are read here (read only; nothing is acted on through them).
 * @param {import('playwright-core').Page} page
 * @returns {Promise<object>} {panel: 'absent'} or {busy, overlay, cardHidden, stoppedShown, stopButtons, panelClass}
 */
export const readPanel = page => page.evaluate(() => {
  const root = document.getElementById('jobpilotto-review-host')?.shadowRoot;
  if (!root) return {panel: 'absent'};
  const one = selector => root.querySelector(selector);
  return {busy: !!one('.fill.is-busy'), overlay: !!document.getElementById('jobpilotto-fill-overlay'), cardHidden: !!one('.card')?.hidden, stoppedShown: !!one('.stopped') && !one('.stopped').hidden,
    stopButtons: [...root.querySelectorAll('.stop-btn, .pill-stop')].map(button => `${button.textContent.trim()}${button.disabled ? ' (disabled)' : ''}`), panelClass: one('.jp')?.className || ''};
});

/** What the person sees after a Stop, in the order it happens: each its own state, waited for on its own (one event per action), each named in the failure. */
export const STOP_STAGES = [
  {what: 'the fill\'s step row ended (no busy step)', accepts: state => !state.busy},
  {what: 'the dim over the page lifted', accepts: state => !state.overlay},
  {what: 'the panel showed "Stopped by you" (or stayed minimised)', accepts: state => state.cardHidden || state.stoppedShown},
];

/** True when the panel shows the fill ended by Stop: every stage of STOP_STAGES holds, on a page that has the panel. */
export const isStopped = state => state.panel !== 'absent' && STOP_STAGES.every(stage => stage.accepts(state));

/**
 * Press the panel's Stop and wait for the panel to show the fill stopped.
 * @param {import('playwright-core').Page} page  the job form's tab
 * @param {{capMs?: number}} [options]  capMs: only for a test with no runner step; in a step the step's clock (lib/wait-on-state.mjs stepTimeLeft) is the only bound (Rule B), and with neither pollUntil's own default applies
 * @returns {Promise<{state: object, ms: number}>} the panel's state when it showed stopped
 * @throws {Error} naming what was seen: the Stop control never became pressable, or the panel never showed stopped (with its last state)
 */
export async function pressStop(page, {capMs} = {}) {
  const budget = stepTimeLeft() ?? capMs;   // undefined outside a step and without a test cap: pollUntil's default
  const deadline = budget === undefined ? undefined : Date.now() + budget;   // Why (PR #2748, Gitar): one deadline from before the press; the wait for a pressable Stop spends part of it, the stages get what is left
  const stop = page.locator(HOST).getByRole('button', {name: 'Stop', exact: true});
  try {
    await stepWait('the Stop control was visible, enabled and still', timeout => stop.click({timeout: timeout ?? capMs}));
  } catch (error) {
    throw new Error(`Stop was never pressable (${String(error.message).split('\n')[0]}); the panel showed ${JSON.stringify(await readPanel(page).catch(() => 'unreadable'))}`);
  }
  const started = Date.now();
  let value = {panel: 'absent'};
  for (const stage of STOP_STAGES) {   // one event per action: each expected state is waited for on its own, with its own message, never one combined wait at the end
    const left = deadline === undefined ? undefined : Math.max(0, deadline - Date.now());
    ({value} = await pollUntil(() => readPanel(page), state => state.panel !== 'absent' && stage.accepts(state), {capMs: left, label: elapsed => `${stage.what} ${elapsed} ms after the press`}));
    if (value.panel === 'absent' || !stage.accepts(value)) throw new Error(`Stop did not halt the fill: ${waitCapNote(stage.what, (budget ?? 45000) / 1000, value)}`);
  }
  const ms = Date.now() - started;
  return {state: value, ms};
}

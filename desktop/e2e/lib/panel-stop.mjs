/* global document */
// The person's Stop on the page panel, pressed the way a person presses it, then judged by the panel's own state; a failure names that state.
// Job: wait on state
// Why (31 Oct 2026, a8; PR #2746's harness run 41250657527): "Stop halts a fill with the panel open" was red with only "Stop did not halt the fill"; the failure now names the panel's state, which is how run 41265375751 gave its cause.
// Why (1 Nov 2026, owner's manifest via coordinator): "Fixing a red never changes a selector unless the locator is objectively broken": the Stop is found by the same selectors the test used
// before (`.stop-btn` for the open panel, `.pill-stop` for the minimised pill); only the readiness and the state waits changed.
// Design (1 Nov 2026, a8; after 5 patches in #2746 to one mechanism): a Stop press is judged by the panel, not by the click's clock. States read only from the panel: not pressable yet, pressed ("Stopping…" or a later state), stopped (STOP_STAGES).
// One owner (pressStop), one hang guard for the whole press; the click call's return is not a verdict; a press that landed is never repeated.
// Invariants: the control is the open panel's `.stop-btn`, or with `minimised` the pill's `.pill-stop`, found at the moment of the press; the press is Playwright's trusted
// click, which waits until the control is visible, enabled, still and not covered; each state the Stop should change (STOP_STAGES) is read from the panel in a loop and waited for on its own, never one combined wait at the end (one event per action); the loops end at the one deadline (the caller's cap or the step's clock).
// Tests: test/panel-stop-verdict.test.mjs (verdicts on a fake page and clock), test/panel-stop.test.mjs (what needs a real browser)
import {POLL_CAP_MS, pollUntil, stepTimeLeft, stepWait, waitCapNote} from './wait-on-state.mjs';

const HOST = '#jobpilotto-review-host';

/** The one budget of a press, spent across the click and the three stages: the step's time left, else the test's cap, else pollUntil's own default (never a fresh budget per wait). */
export const pressBudget = ({stepLeft, capMs}) => stepLeft ?? capMs ?? POLL_CAP_MS;

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

/** True when the panel shows the press landed: a Stop reads "Stopping…" (the panel's own reaction to a trusted press), or a later state is already seen. */
export const isPressed = state => state.panel !== 'absent' && (state.stopButtons.some(label => label.startsWith('Stopping…')) || isStopped(state));

/**
 * Press the panel's Stop and wait for the panel to show the fill stopped.
 * Design (1 Nov 2026, a8): states read only from the panel: not pressable yet, pressed, stopped. One hang guard (pressBudget) for the whole press. The click call's own
 * return is not a verdict: after it (resolved or timed out) the panel is read; "Stopping…" or any later state means pressed, and a press is never repeated.
 * @param {import('playwright-core').Page} page  the job form's tab
 * @param {{capMs?: number, minimised?: boolean, now?: () => number, pause?: (ms: number) => Promise<void>}} [options]  minimised: the panel is minimised, so the pill's Stop is the one pressed. capMs: only for a test with no runner step; in a step the step's clock (lib/wait-on-state.mjs stepTimeLeft) is the only bound (Rule B), and with neither pollUntil's own default applies. now/pause: an injected clock for a test
 * @returns {Promise<{state: object, ms: number}>} the panel's state when it showed stopped
 * @throws {Error} naming the panel's last state and the state waited for: never pressable (the click failed and no press shows), clicked but never shown pressed, or pressed but never showed stopped
 */
export async function pressStop(page, {capMs, minimised = false, now = Date.now, pause} = {}) {
  const budget = pressBudget({stepLeft: stepTimeLeft(), capMs});
  const deadline = now() + budget;   // Why (PR #2748, Gitar x2; redesign 1 Nov 2026): one hang guard from before the press; the click and every stage spend what is left of it, never a fresh budget
  const stop = page.locator(HOST).locator(minimised ? '.pill-stop' : '.stop-btn');   // exactly what the test pressed before, inside the panel's host (owner's manifest: a fix does not change a selector that works)
  const wait = (accepts, label) => pollUntil(() => readPanel(page), state => state.panel !== 'absent' && accepts(state), {capMs: Math.max(0, deadline - now()), now, ...(pause && {pause}), label});
  let clickError = null;
  try {
    await stepWait('the Stop control was visible, enabled and still', timeout => stop.click({timeout: timeout ?? Math.max(1, deadline - now())}));
  } catch (error) { clickError = String(error.message).split('\n')[0]; }
  // Why (1 Nov 2026, a8; harness run 41265375751 on #2766): a loaded runner timed the click call out after the press had landed (`Stopping… (disabled)`), and the press was judged "never pressable"; the panel decides, so it is read after the click call either way.
  const {value: seen} = await wait(isPressed, ms => `the panel showed the press ${ms} ms after the click`);
  if (!isPressed(seen)) throw new Error(clickError === null
    ? `Stop was clicked but the panel never showed it pressed within ${budget / 1000} s (last seen: ${JSON.stringify(seen)})`
    : `Stop was never pressable (${clickError}); the panel showed ${JSON.stringify(seen)}`);
  const started = now();
  let value = seen;
  for (const stage of STOP_STAGES) {   // one event per action: each expected state is waited for on its own, with its own message, never one combined wait at the end
    ({value} = await wait(stage.accepts, elapsed => `${stage.what} ${elapsed} ms after the press`));
    if (value.panel === 'absent' || !stage.accepts(value)) throw new Error(`Stop did not halt the fill: ${waitCapNote(stage.what, budget / 1000, value)}`);
  }
  return {state: value, ms: now() - started};
}

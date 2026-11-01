/* global document */
// A person's click on a page the extension is filling: wait for its overlay to lift, click, and click again if the overlay came back in between (c09c6a8 holds trusted clicks).
// Job: wait on state
import {fillState} from './extension.mjs';
import {stepWait} from './wait-on-state.mjs';
const GONE = () => !document.getElementById('jobpilotto-fill-overlay');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** What the page shows while the overlay holds the click: the overlay up or down, the extension's fill state (with its last error) and the address. */
export async function liftState(tab) {
  const overlay = await tab.evaluate(() => !!document.getElementById('jobpilotto-fill-overlay')).then(up => (up ? 'up' : 'down'), error => `unreadable: ${String(error?.message || error).split('\n')[0].slice(0, 120)}`);
  return {overlay, fill: await fillState(tab), url: String(tab.url?.() || '').split('#')[0].slice(0, 100)};
}

/** Waits for the fill overlay to lift, at most the step's remaining time (its hang guard). A timeout names the state it saw, never "Timeout 30000ms exceeded".
 * Why (1 Nov 2026, a8, red 41267492981, applyflows-2of3): the sign-up step failed with a bare `waitForFunction: Timeout 30000ms exceeded` at this line; the extension's log showed its own
 * storage read taking 30 s (#2608), so the overlay stayed up while nothing here could say so. The wait is now the step's clock, and its failure carries the last state. */
async function overlayLifted(tab) {
  await stepWait('the fill overlay lifted', async timeout => {   // the step's remaining time; outside a step (a unit test) Playwright's own default
    try { await tab.waitForFunction(GONE, null, timeout === undefined ? {} : {timeout}); } catch (error) {
      throw new Error(`the fill overlay did not lift (last state: ${JSON.stringify(await liftState(tab))}): ${String(error?.message || error).split('\n')[0]}`);
    }
  });
}

// `act` is one Playwright action on the tab (check or click); a click lost under a returning overlay throws or changes nothing, so it is tried again after the overlay lifts.
export async function whenFree(tab, act, {tries = 6} = {}) {
  let last = null;
  for (let at = 0; at < tries; at += 1) {
    await overlayLifted(tab);
    try { return await act({timeout: 5000}); } catch (error) { last = error; }
  }
  throw last;
}

export const ticked = (tab, selector) => whenFree(tab, options => tab.check(selector, options));   // check() throws when the box did not change: a held tick is retried

// A press counts only when what it does shows (`landed`, e.g. the page moved on): the overlay drops a trusted click without any error, so a click "succeeds"
// and nothing happens (26 Oct 2026, beta 40275152602: "Create account" eaten after the overlay came back, the sign-up page never left, 91 s lost). Until it
// shows (landMs per try), the click is made again once the overlay lifts. Guard: test/ai/free-click.test.mjs.
export async function pressed(tab, selector, {landed, landMs = 8000, tries = 6, step = 250} = {}) {
  if (typeof landed !== 'function') throw new Error(`pressed(${selector}) needs landed(): a click the fill overlay held throws nothing`);
  let last = null;
  for (let at = 0; at < tries; at += 1) {
    if (await landed()) return;
    try { await whenFree(tab, options => tab.click(selector, options), {tries: 1}); } catch (error) { last = error; }
    for (let waited = 0; waited < landMs; waited += step) { if (await landed()) return; await pause(step); }
  }
  throw new Error(`the press on ${selector} never took effect after ${tries} tries${last ? `: ${last.message}` : ''}`);
}

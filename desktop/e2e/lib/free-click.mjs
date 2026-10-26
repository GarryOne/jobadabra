/* global document */
// A person's click on a page the extension is filling: wait for its overlay to lift, click, and click again if the overlay came back in between (c09c6a8 holds trusted clicks).
const GONE = () => !document.getElementById('jobpilotto-fill-overlay');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// `act` is one Playwright action on the tab (check or click); a click lost under a returning overlay throws or changes nothing, so it is tried again after the overlay lifts.
export async function whenFree(tab, act, {tries = 6, liftMs = 30000} = {}) {
  let last = null;
  for (let at = 0; at < tries; at += 1) {
    await tab.waitForFunction(GONE, null, {timeout: liftMs});
    try { return await act({timeout: 5000}); } catch (error) { last = error; }
  }
  throw last;
}

export const ticked = (tab, selector) => whenFree(tab, options => tab.check(selector, options));   // check() throws when the box did not change: a held tick is retried

// A press counts only when what it does shows (`landed`, e.g. the page moved on): the overlay drops a trusted click without any error, so a click "succeeds"
// and nothing happens (26 Oct 2026, beta 40275152602: "Create account" eaten after the overlay came back, the sign-up page never left, 91 s lost). Until it
// shows (landMs per try), the click is made again once the overlay lifts. Guard: test/free-click.test.mjs.
export async function pressed(tab, selector, {landed, landMs = 8000, tries = 6, liftMs = 30000, step = 250} = {}) {
  if (typeof landed !== 'function') throw new Error(`pressed(${selector}) needs landed(): a click the fill overlay held throws nothing`);
  let last = null;
  for (let at = 0; at < tries; at += 1) {
    if (await landed()) return;
    try { await whenFree(tab, options => tab.click(selector, options), {tries: 1, liftMs}); } catch (error) { last = error; }
    for (let waited = 0; waited < landMs; waited += step) { if (await landed()) return; await pause(step); }
  }
  throw new Error(`the press on ${selector} never took effect after ${tries} tries${last ? `: ${last.message}` : ''}`);
}

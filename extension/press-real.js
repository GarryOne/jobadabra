// Move 2 of the hybrid fill (owner, 26 Oct 2026: the extension stays the one filler and gains Playwright's useful moves through the debugger it already holds), the worker's side:
// a choice the fill answered that a scripted click did not take (a radio group that hears only a real click, a custom dropdown that opens only on a real mousedown) is pressed
// again the way a person presses: a trusted click through Chrome's debugger (fill-verify.js sends it, inside the driver gap) on the spot the page names (page/press-real.js), for a dropdown the opener first and then the option
// the page shows with the fill's answer, then read back. Rung 0's sibling of the real typing (fill-verify.js), in the same debugger turn. Floors: each point is checked by the
// press floor first (page/submit-press.js markAt: never a submit, never a delete/withdraw/decline), at most 6 controls, no key is pressed. Counts only leave this file.
// Guard: worker/test/hybrid-moves.test.js; the widget zoo's radio-trusted-only-1 and custom-select-1.
const MAX = 6, SETTLE_MS = 300;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// page(func, args) runs in the page (main world); mouse(x, y) is the caller's trusted click (the debugger's mouse events, inside the driver gap: fill-verify.js). -> {tried, taken}
export async function pressNotTakenForReal({page, mouse, wait = sleep}) {
  const spots = ((await page(() => window.__jobPilottoPressSpots?.() || []).catch(() => [])) || []).slice(0, MAX);
  const press = async ({x, y}) => {
    if ((await page((px, py) => globalThis.__jobPilottoSubmitPress?.markAt(px, py), [x, y]).catch(() => true)) === false) return false;   // the extension's own press, behind the press floor
    await mouse(x, y);
    return true;
  };
  let taken = 0;
  for (const spot of spots) {
    if (!(await press(spot))) continue;
    if (spot.step === 'opener') {
      await wait(SETTLE_MS);   // the list draws its options after the press
      const option = await page(field => window.__jobPilottoPressOptionSpot?.(field) || null, [spot.field]).catch(() => null);
      if (!option || !(await press(option))) continue;
    }
    await wait(SETTLE_MS);
    if (await page(field => window.__jobPilottoPressedNow?.(field) || false, [spot.field]).catch(() => false)) taken += 1;
  }
  return {tried: spots.length, taken};
}

// Is there anything to press on this page? (The caller attaches the debugger only then.)
export const hasPressSpots = page => page(() => (window.__jobPilottoPressSpots?.() || []).length > 0).catch(() => false);

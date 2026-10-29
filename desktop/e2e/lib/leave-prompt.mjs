// Going to a page when the one being left may ask first: a page with unsaved edits opens its save bar's leave dialog (Keep editing / Discard all / Save,
// renderer/save-bar.js leave; Strategy and Profile since 18 Oct 2026), a modal that covers every later click (CI run 241, 9 Oct 2026: six interactions steps timed out behind it).
// A suite's own edits are nobody's: discard them and say so. Used by suites/interactions.mjs; guarded by test/leave-prompt.test.mjs.
// Job: wait on state
/* global document, getComputedStyle */
import {goView} from './go-view.mjs';
export const LEAVE_DIALOG = 'dialog[open]:has(button[value="keep"]):has(button[value="discard"])';
export async function goTo(page, view, say = console.log) {
  await goView(page, view);
  const destination = `.view[data-view="${view}"]:not([hidden])`;
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].some(node =>
    node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'), `${LEAVE_DIALOG}, ${destination}`, {timeout: 2000});
  const leave = page.locator(LEAVE_DIALOG);
  if (!await leave.count()) return false;
  await leave.locator('button[value="discard"]').click();
  await page.locator(destination).waitFor({timeout: 15000});
  say(`  leaving Strategy asked about unsaved edits the suite made: discarded, on to ${view}`);
  return true;
}

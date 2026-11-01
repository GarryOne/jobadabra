// The "how do you want to start?" step (Workday's "Start Your Application": Apply Manually / Use My Last Application / Apply With LinkedIn, 10 Oct 2026):
// after Apply was pressed and no form came, the page is judged AGAIN (fresh, the kept answer is for the plain posting) and the page-kind AI names the ROUTE of
// the button it picked (desktop/lib/page-kind.js ROUTES). Decisions: the route and the button are the AI's; structure only finds the button by its text (fill-flow.js
// pressApply); the floors are here: only the manual route is ever pressed, a third-party sign-in (LinkedIn, Google, Apple…) never, one look per tab and page.
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. Only the manual route is pressed; reuse_previous and third_party_account are reported, never pressed (app-core/test/start-route.test.js).
//  2. One look per tab and page; a new tab or a reload (forgetRouteTries) may look again (app-core/test/start-route.test.js).
//  3. No AI answer, no route: nothing is pressed (app-core/test/start-route.test.js).
const tried = new Set();
export const forgetRouteTries = tabId => { for (const key of [...tried]) if (key.startsWith(`${tabId} `)) tried.delete(key); };

// ask(): the page-kind answer asked fresh ({applyRoute, applyButton} or null); press(phrases): presses the page's button by those phrases ({pressed}).
// -> {route, pressed}: route '' when the page names none; pressed the button's text, '' when nothing was pressed.
export async function startRoute(key, {ask, press}) {
  if (tried.has(key)) return {route: '', pressed: '', skipped: true};
  tried.add(key);
  const kind = await ask();
  const route = kind?.applyRoute || '';
  if (route !== 'manual' || !kind.applyButton) return {route, pressed: ''};
  const attempt = await press([{key: 'apply_button', phrase: kind.applyButton}]);
  return {route, pressed: attempt?.pressed || ''};
}

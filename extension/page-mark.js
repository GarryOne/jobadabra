// What the page IS, said on the page for the panel AND to the app at once (owner, 15-16 Oct 2026: the panel and the desktop said "Ready to submit" on a posting, and the desktop sat on
// "Reading this page" through the sign-in page, which has no panel to report). The AI's kind decides in fill-flow.js and account-step.js; this only says it, in real time:
// 'reading' (being read) → 'posting' ("Apply button detected. Redirecting…") → 'opening' (Apply pressed) → 'account' / 'sign-up' (a sign-in or sign-up form) → 'signing-in' /
// 'signing-up' (its button pressed) → 'form' (the application form: the panel counts). The panel counts and says Ready only on 'form' or an account page (review.js).
// Guards: desktop/test/extension-panel-notes.test.js, desktop/test/page-steps.test.js.
import {apiFor, settings} from './flow.js';
import {sessionOf} from './tab-identity.js';
import {markOf} from './tab-pages.js';
import {workingMark} from './working-mark.js';

// The app hears each step from the worker itself, so a page with no panel (a small sign-in page) still moves the desktop's card.
async function tellApp(tabId, page) {
  const session = await sessionOf(tabId).catch(() => '');
  const config = session ? await settings().catch(() => null) : null;
  if (config) apiFor(tabId, config, '/extension/event', {method: 'POST', body: JSON.stringify({type: 'page', page, session, tab: tabId})}).catch(() => {});
}

export async function markPage(tabId, role, pressed = false, kind = null, {working = false} = {}) {   // kind: the AI's page answer, for a sign-up page's own words; working: the read goes on, so no verdict (working-mark.js)
  const mark = markOf(role, pressed, kind?.accountStep || '', kind?.kind || ''), value = working ? workingMark(mark) : mark;
  await chrome.scripting.executeScript({target: {tabId}, func: mark => {
    if (mark) document.documentElement.setAttribute('data-jobpilotto-page', mark); else document.documentElement.removeAttribute('data-jobpilotto-page');
  }, args: [value]}).catch(() => {});
  if (value) await tellApp(tabId, value);
}

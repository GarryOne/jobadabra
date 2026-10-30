// The dismissal half of the Focus suite (6 Oct 2026): the five ways to finish an Up next card, the in-app hold and Dismiss in process, on a REAL Notion page:
// part of the real-Notion contract set, where Notion's lag after a write is what these steps are about. Same file as suites/focus.mjs (runFocus); its own page (E2E_NOTION_TOKEN_FOCUSDISMISS).
// Job: serve stored answers
import {runFocus, stepNeeds as focusNeeds} from './focus.mjs';

export const name = 'focusdismiss';
export const keepGoing = true;
// Why (30 Oct 2026, #2601): setup's contact_from_cv ask already has a reviewed kind reply; do not depend on a hash cache or live AI.
export const aiAnswers = 'backbone';
// Why (30 Oct 2026, #2601): dismissal steps inject Notion listing lag with ctx.standIn.setLag; keep that existing fault path reachable.
export const store = 'standin';
export const minutes = 15;
export const stepNeeds = focusNeeds;
export const run = ctx => runFocus(ctx, ['dismiss']);

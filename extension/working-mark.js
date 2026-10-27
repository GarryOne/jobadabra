// No verdict while the extension is still working (owner, 27 Oct 2026: "That's a very big bug. Please, don't show a verdict" ... "IF the extension didn't stop thinking"): the panel
// said "This page shows no application" + "Fill again" on a Greenhouse form, then started filling it a few seconds later (a field watch judged it again). A page mark set while the read
// goes on (before the Apply press, the ladder's climbs, a field watch that may judge the page again) never carries an end verdict, only "Reading this page…"; the verdict is said once the
// flow stopped (fill-flow.js: the end block, or the watch's end with no form). Guard: worker/test/working-mark.test.js.
export const END_MARKS = ['other'];   // tab-pages.js markOf's verdicts ("This page shows no application", review.js MARK_WORDS)
// The mark to show while the flow still works: a verdict becomes "reading"; progress marks (posting, opening, form, account…) stay.
export const workingMark = mark => (END_MARKS.includes(mark) ? 'reading' : mark);

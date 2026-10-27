// No verdict while the extension is still working (owner, 27 Oct 2026: "That's a very big bug. Please, don't show a verdict" ... "IF the extension didn't stop thinking"): the panel
// said "This page shows no application" + "Fill again" on a Greenhouse form, then started filling it a few seconds later. A page mark set while the read goes on (before the Apply press,
// the ladder's climbs, the field watch) never carries an end verdict, only "Reading this page…"; and a no-form answer on a page that already shows a form's fields is looked at once more
// before any verdict (fill-flow.js). Guard: worker/test/working-mark.test.js.
export const END_MARKS = ['other'];   // tab-pages.js markOf's verdicts ("This page shows no application", review.js MARK_WORDS)
// The mark to show while the flow still works: a verdict becomes "reading"; progress marks (posting, opening, form, account…) stay.
export const workingMark = mark => (END_MARKS.includes(mark) ? 'reading' : mark);
// The page shows a form's fields: the same count the field watch looks again at (fill-flow.js watchForFields).
export const showsFields = counts => !!counts && (Number(counts.fields) || 0) + (Number(counts.textareas) || 0) + (Number(counts.files) || 0) >= 2;
// A no-form end on such a page waits for one more look, once per page (the watch's own once): -> true to hold the verdict.
export const holdVerdict = ({role, counts, lookedAgain = false}) => role === 'no-form' && !lookedAgain && showsFields(counts);

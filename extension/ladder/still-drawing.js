// Reads a page again while the page-kind AI says it is still being drawn (a placeholder, a cover over an empty shell, a "Loading" notice): a fill planned from a half-drawn page asks about the wrong controls.
// The AI judges "ready?" (its fixed answer stillDrawing, desktop/lib/ladder/rung2-sketch.js); this file only waits for the page to be still and asks again, at most MAX_LOOKS times. At the cap the last answer
// is used as it is (today's way) and the cause is logged, never a loop and never a silent stop. Guard: app-core/test/still-drawing.test.js.
export const MAX_LOOKS = 2;
// afterChange: a page that is quiet because its content has not come yet is waited on (until it changes and is still, at most maxMs), not read again after half a second of silence.
export const STILL_MS = {quietMs: 500, maxMs: 2500, afterChange: true};

// asked: the first answer; again(): the page-kind ask once more, fresh; still(): resolves when the page has been still (pageStill); log: decide.
// unanswered(): true when there is NO answer and the page shows no control at all (an empty shell): a missing answer is never kept as sure (CLAUDE.md), so it is waited on and asked again like a
// "still drawing" one, at the same cap (16 Oct 2026: a signed-in Workday step read as an empty "Careers" shell on a slow machine ended at "no Apply button to press").
export async function readWhileDrawing(asked, {again, still, log, host = '', unanswered}) {
  let looks = 0, answer = asked;
  const drawing = async () => answer?.stillDrawing === true || (!answer && !!(await unanswered?.()));
  while (looks < MAX_LOOKS && await drawing()) {
    looks++;
    await still();
    const next = await again();
    if (!next) break;   // no answer: the page is read as it stands
    answer = next;
  }
  if (looks) log('fill', answer?.stillDrawing === true ? 'page still drawing at the cap: read as it stands' : 'page was still drawing: read again', {looks, host, cause: answer?.stillDrawing === true ? 'cap' : 'settled'});
  return answer;
}

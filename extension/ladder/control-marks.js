// Writes the fill's cause for each control it left onto the control (data-jobpilotto-cause, a fixed word of fill-card.js CAUSES), so the panel can say why each one is left (page/review-payload.js `why`)
// and the app can show the reason class on the person card. Never a value or a label. The card's `marks` list is removed here: it never leaves the worker. Guard: app-core/test/control-marks.test.js.
import {CAUSES} from '../fill-card.js';

export async function markCauses(inPage, tabId, card) {
  const marks = (card?.marks || []).filter(mark => mark.field && CAUSES.includes(mark.cause));
  if (card) delete card.marks;
  if (!marks.length) return 0;
  return (await inPage(tabId, list => {
    let marked = 0;
    for (const {field, cause} of list) {
      const named = document.getElementById(field) ? [document.getElementById(field)] : Array.from(document.getElementsByName(field));   // a group of options shares its name: every one carries the cause
      for (const el of named) { el.setAttribute('data-jobpilotto-cause', cause); marked += 1; }
    }
    return marked;
  }, [marks]).catch(() => 0)) || 0;
}

// A later look that says the page is the form (extension/fill-flow.js, after an Apply press that brought nothing): the first page-kind answer said no form ("other",
// a posting) but the fresh look asked after the press says "form", at least as sure: the page IS the form, so it is filled instead of being handed to the person
// (a check it also names is one of the form's fields, done by the person at the end, as for any form answer). Greenhouse, 27 Oct 2026: the first read (20.7 s) said other + bot check while the form's 18 fields were on the page; the look after the press said
// form 0.95, but only its route and frame were read, so the panel said "stuck" until a field watch looked again. Guard: worker/test/later-look.test.js.
// first, later: page-kind answers ({role, kind, confidence, botCheck}). -> true when the later one makes the page the form.
export function laterLookIsForm(first, later) {
  if (!later || later.role !== 'form' || later.stillDrawing || later.error) return false;
  if (first?.role === 'form') return false;   // nothing to correct
  return (Number(later.confidence) || 0) >= (Number(first?.confidence) || 0);
}

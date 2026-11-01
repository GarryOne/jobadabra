// The picture checked against the sketch (spec 2026-10-12-one-next-move.md, box 6): the picture's answer counts the buttons and links it shows; PARTIAL_BY or more over what the sketch lists is a partial view,
// a perception gap logged as fixed numbers (never page words) so the pool counts blind spots as data. Guard: app-core/test/picture-crosscheck.test.js.
export const PARTIAL_BY = 3;   // a count read off a picture is rough: a gap under this is noise

// the answer from the app ({shown, listed}: -1 or absent = not measured) -> {shown, listed, partial}
export function viewOf(answer) {
  const count = value => Number.isInteger(value) && value >= 0 ? value : -1;
  const shown = count(answer?.shown), listed = count(answer?.listed);
  return {shown, listed, partial: shown >= 0 && listed >= 0 && shown - listed >= PARTIAL_BY};
}

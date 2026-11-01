// The next move checked (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 5, "Making the next move right"): the ONE rule that says whether the fallback's move
// may act, and the effect each verb must show right after acting. Pure: the shadow question (ladder/fallback.js) logs what it would decide; the CI pool acting (box 8) uses it to act.
// A move acts only when sure (>= 0.8: below, climb), past the floors (the live press path's own, checked by fallback.js), and a press only when a second ask names the same control
// (the worthRetry idea: variance is caught by asking again). No effect after acting = failed: never repeated, the next rung is asked with what was tried. Guard: app-core/test/next-move.test.js.

export const ACT_FROM = 0.8;
const PRESSES = ['press', 'open'];
const sure = move => move?.signal === 'confident' && Number(move.confidence) >= ACT_FROM;

// move, second: the fallback's logged fields of the first and the second ask. -> {act, why}: why is one of blind, person, unsure, floor, one_ask, disagree, agreed.
export function mayAct(move, second = null) {
  if (move?.verb === 'not_listed' || move?.signal === 'blind') return {act: false, why: 'blind'};   // the way on is not in the list: the picture, never a guess (core.js)
  if (!move || !PRESSES.includes(move.verb)) return {act: false, why: 'person'};   // nothing to press: the person is told (today's worst case)
  if (!sure(move)) return {act: false, why: 'unsure'};
  if (move.floor !== 'ok') return {act: false, why: 'floor'};
  if (!second) return {act: false, why: 'one_ask'};
  if (second.verb !== move.verb || second.number !== move.number || !sure(second) || second.floor !== 'ok') return {act: false, why: 'disagree'};
  return {act: true, why: 'agreed'};
}
// The second ask costs one more digest call: spent only where it can change the answer, a sure press the floors let through.
export const needsSecondAsk = move => !!move && PRESSES.includes(move.verb) && sure(move) && move.floor === 'ok';

// The effect a move must show right after acting. observed: {form, navigated, fields, changed, requiredLost, valueStayed} (facts of the page, counted by structure).
// -> 'worked', 'failed', or 'none' for a move with no page effect (the person is told).
export function effectOf(move, observed = {}) {
  if (move?.verb === 'fill') return observed.valueStayed ? 'worked' : 'failed';
  if (!PRESSES.includes(move?.verb)) return 'none';
  if (move.pressKind === 'continue') return observed.changed && !observed.requiredLost ? 'worked' : 'failed';   // a middle step's next: the page moved on, nothing required lost
  return observed.form || (observed.navigated && observed.fields > 0) ? 'worked' : 'failed';   // an apply: a form, or a new page WITH fields for this job
}

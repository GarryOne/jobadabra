// The ladder's signals and the one rule that says which rung to ask next (spec: docs/superpowers/specs/2026-10-10-ai-ladder.md). Pure: no chrome API, no AI, no storage, so the
// extension and the app (desktop/shared/ladder-core.js, copied by scripts/stage.mjs) decide the same way. Every rung of the applying flow answers with one fixed SIGNAL; a rung that is
// not confident hands the page to the next rung that is on and not capped, and the top is the person. The caps and the switches are the caller's (desktop/lib/ladder.js).
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. Rungs and signals are fixed lists; the log line is exactly `ladder: rung N signal S` (jobadabra-b8's admin parser reads it) and is empty for a confident rung (desktop/test/ladder-core.test.js).
//     Every copy of the signal list equals this one (desktop/test/ladder-signal-copies.test.js). 'blind' added with the owner's OK (13 Oct 2026, spec 2026-10-12-one-next-move.md box 6):
//     the answer said the control it needs is not in the list it was given, so no text rung can see it: it goes straight to the picture.
//  2. Only a signal that is not confident climbs; a rung that is off or capped is skipped, never asked (desktop/test/ladder-core.test.js).
//  3. The router never starts Claude's takeover (rung 5): after the picture comes the person, who is offered it (desktop/test/ladder-core.test.js).
//  4. An unknown rung or signal is never guessed: it goes to the person (desktop/test/ladder-core.test.js).
export const RUNGS = {structure: 0, kept: 1, sketch: 2, digest: 3, picture: 4, takeover: 5, person: 6};
export const SIGNALS = ['confident', 'unsure', 'contradicted', 'stalled', 'failed', 'blind'];
const PERSON = RUNGS.person;
// The rungs the router may ask, in order. 0 (structure) is the floor, not a step up; 5 is offered to the person, never started here.
const CLIMB = [RUNGS.kept, RUNGS.sketch, RUNGS.digest, RUNGS.picture];

// -> {rung, climbed: false} when it stays, or {rung, climbed: true, from, signal}. `off` / `capped`: rungs not to ask now (a switch is off, a cap is used up).
export function nextRung(args) {
  const {rung, signal, off = [], capped = []} = args || {};   // null or nothing: an unknown rung, so the person (invariant 4)
  const known = Object.values(RUNGS).includes(rung) && SIGNALS.includes(signal);
  if (!known) return {rung: PERSON, climbed: true, from: rung, signal};   // invariant 4
  if (signal === 'confident' || rung === PERSON) return {rung, climbed: false};
  const next = CLIMB.find(one => one > rung && (signal !== 'blind' || one === RUNGS.picture) && !off.includes(one) && !capped.includes(one));   // blind: no text rung can see it
  return {rung: next ?? PERSON, climbed: true, from: rung, signal};
}

export function ladderLine(args) {
  const {rung, signal} = args || {};
  return Object.values(RUNGS).includes(rung) && SIGNALS.includes(signal) && signal !== 'confident' ? `ladder: rung ${rung} signal ${signal}` : '';
}

// The fixed signal of a judge's result, so every rung hands up the same way: an account judgment ({answer} or {error}) and the closer look ({action}) alike. A decision to act is confident; a page left to the
// person (unsure, no action, ask the person) hands the page up; no answer at all is a failure. Never a value outside SIGNALS.
export function signalOf(result) {
  if (!result || typeof result !== 'object' || result.error) return 'failed';
  if (result.answer) return result.answer === 'unsure' ? 'unsure' : 'confident';
  if (result.action) return ['click', 'fill', 'choose', 'wait'].includes(result.action) ? 'confident' : 'unsure';
  return 'unsure';
}

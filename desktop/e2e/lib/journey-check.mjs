// Judges a replayed journey by what the person saw (lib/journey-watch.mjs steps) against what the live run did: the card's marks in the live run's order, and a few
// safety invariants. "Same as live" or it fails; no hand-written expectation beyond: never Submitted, never "Ready" without counted fields all done, the panel always has its
// Report button, the card never ends on a step that always moves on. Expected marks come from the live app log's `[review] page` lines; a record made before the app logged them
// (all of 16 Oct 2026's) uses the marks journeys.json blesses for its row, until the row is recorded again. Guard: e2e/test/replay/journey-check.test.mjs.
import {PAGE_LINES, pageLine} from '../../renderer/session-state.js';   // pure: no staged worker files needed (a fresh CI runner has none before the replay stages them)

const READY_WORDS = ['Ready to submit', 'Ready for review', 'Submitted'];
const MOVES_ON = ['reading', 'posting', 'opening', 'signing-in', 'signing-up'];   // a step the journey always leaves: ending on one is a stall ("Logging in…" for ever)

// One mark per distinct card state: the page step the extension said, else 'form' once the panel counts fields. steps: journey-watch steps -> [mark]
export function marksOfSteps(steps) {
  const marks = [];
  for (const {card} of steps) {
    const mark = card.page || (card.total > 0 ? 'form' : '');
    if (mark && marks.at(-1) !== mark) marks.push(mark);
  }
  return marks;
}

// The live log's marks, from its `[review] page <session>: <mark>` lines (builds from 16 Oct 2026), repeats folded; [] for a log made before the app wrote them.
export function liveMarksOf(log) {
  const said = String(log || '').split('\n').map(line => /\[review\] page \S+: (\S+)/.exec(line)?.[1]).filter(Boolean);
  return said.filter((mark, at) => said[at - 1] !== mark && (mark in PAGE_LINES || mark === 'form'));
}

const inOrder = (want, have) => { let at = 0; const missing = []; for (const mark of want) { const found = have.indexOf(mark, at); if (found < 0) missing.push(mark); else at = found + 1; } return missing; };
const words = mark => (mark === 'form' ? 'the form\'s counts' : `"${pageLine(mark)}"`);

// steps: watch steps; liveLog: the record's app.log; blessed: journeys.json's marks for a record made before the app logged them (the replay on main that the owner's live run confirmed).
// -> {failures: [line], marks: {replay, live}}
export function checkJourney({steps, liveLog, blessed = []}) {
  const failures = [], replay = marksOfSteps(steps), fromLog = liveMarksOf(liveLog), live = fromLog.length ? fromLog : blessed;
  if (!live.length) failures.push('no expected marks: the live log has no page lines and journeys.json blesses none for this row');
  if (!steps.length) failures.push('the card was never read: no session or no step');
  for (const mark of inOrder(live, replay)) failures.push(`the card never showed ${words(mark)} (live did, in order ${live.join(' > ')}; replay: ${replay.join(' > ') || 'nothing'})`);
  for (const mark of replay) if (!live.includes(mark) && mark !== 'reading') failures.push(`the card showed ${words(mark)}, live never did (live: ${live.join(' > ')})`);
  const last = steps.at(-1);
  if (last && MOVES_ON.includes(last.card.page) && !MOVES_ON.includes(live.at(-1))) failures.push(`the card ends on ${words(last.card.page)}, a step that always moves on (live ended on ${live.at(-1) || 'nothing'})`);
  for (const {at, card, panel} of steps) {
    if (card.words === 'Submitted') failures.push(`${at}s: the card says Submitted: a replay never submits`);
    if (READY_WORDS.includes(card.words) && (card.page || card.total === 0 || card.left > 0)) failures.push(`${at}s: the card says "${card.words}" with ${card.page ? `the step "${card.page}"` : `${card.left} left of ${card.total}`}`);
    if (panel.present && !panel.report) failures.push(`${at}s: the panel is drawn without its Report button`);
  }
  return {failures: [...new Set(failures)], marks: {replay, live}};
}

// One row case (case.json `replay: "row"`, made by npm run row-to-case) replayed the way CI replays it: on the row path (lib/row-replay.mjs, the case's pages, presses and kept model answers, nothing from
// the network) and judged by its `expect` (lib/row-signature.mjs). A cold ask (a model call not in the case's kept answers: CI has no claude -p) and an address the case never recorded fail it too.
// -> {name, ok, failures, seconds}. replay: injectable for tests. Used by e2e/test/recorded-pages.test.mjs and row-to-case.mjs. Guard: e2e/test/row-case-run.test.mjs.
import {checkSignature, signatureOf} from './row-signature.mjs';
import {replayRow} from './row-replay.mjs';
import {movesFromLog} from './ladder-moves.mjs';

// "N answer ask(s) served although the system prompt differs from the capture's: system:1:search_preferences" or ''.
export function looseSummary(hits = []) {
  if (!hits.length) return '';
  const parts = [...new Set(hits.flatMap(hit => hit.differs || []))];
  return `${hits.length} answer ask(s) served although the system side differs from the capture's: ${parts.join(', ') || 'unknown'}`;
}
export const isRowCase = item => item?.replay === 'row';

export async function runRowCase(item, {extensionDir, replay = replayRow, slow = false, ordinal = false} = {}) {   // ordinal: CI only; row-to-case's own proof never serves an ask by order
  const failures = [];
  if (!item.expect || !Object.keys(item.expect).length) failures.push('no expect: a row case gets its expect from row-to-case (the new build\'s replay), never by hand');
  const result = await replay(item.dir, {extensionDir, loose: true, ...(slow ? {slow: true} : {}), ...(ordinal ? {ordinal: true} : {})});   // loose: a prompt or seed change since the capture is a warning, not a cold ask (CI has no claude -p)
  failures.push(...checkSignature(signatureOf(result), item.expect));
  if (result.misses) failures.push(`${result.misses} model ask(s) not in the case's kept answers (CI has no claude -p; row-to-case --ask-cold keeps them)${result.missParts?.length ? `; the nearest kept ask differs in ${result.missParts.join(', ')}` : ''}${result.missVolatile?.length ? `; a clock time or date in ${result.missVolatile.join(', ')}` : ''}`);   // CI shows only this line: say WHICH parts moved (a Linux runner's timing or layout)
  for (const address of result.unrecorded || []) failures.push(`address not recorded: ${address}`);
  if (failures.length && result.timeline?.length) failures.push(`replay timeline: ${result.timeline.join(' | ').slice(0, 1800)}`);   // CI keeps no artifact of a failed replay: its own output is the evidence
  const byOrder = (result.ordinalHits || []).length ? `${result.ordinalHits.length} ask(s) served by ORDER (the n-th kept answer of their kind: no kept answer matched): the case holds only as far as the order does; row-to-case --ask-cold keeps them${[...new Set(result.ordinalHits.flatMap(hit => hit.differs || []))].length ? `; they differ from the closest kept ask in ${[...new Set(result.ordinalHits.flatMap(hit => hit.differs || []))].slice(0, 12).join(', ')}` : ''}` : '';
  const loose = looseSummary(result.looseHits);
  return {name: item.name, ok: !failures.length, failures, confirm: [], seconds: result.seconds, signature: signatureOf(result), loose, ordinal: byOrder, moves: () => movesFromLog(result.appLog)};   // the ladder moves its pages confirmed (lib/ladder-moves.mjs)
}

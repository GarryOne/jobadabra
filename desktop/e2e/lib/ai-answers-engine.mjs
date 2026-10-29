// Dispatch engine item kinds through questionOf and the existing single answer table.
// Job: serve stored answers
import {engineBatchAnswer, engineBatchCandidates} from './ai-answers-engine-items.mjs';
import {placesKind, placesQuestion} from './ai-answers-places.mjs';
import {geoKind, geoQuestion} from './ai-answers-geo.mjs';
import {titleKind, titleQuestion} from './ai-answers-title.mjs';
import {enrichKind, enrichQuestion} from './ai-answers-enrich.mjs';
import {visitKind, visitQuestion} from './ai-answers-visit.mjs';
import {visaKind, visaQuestion, vagueKind, vagueQuestion, readingKind, readingQuestion} from './ai-answers-place-extra.mjs';

const registrations = [
  [placesKind, placesQuestion],
  [geoKind, geoQuestion],
  [titleKind, titleQuestion],
  [enrichKind, enrichQuestion],
  [visitKind, visitQuestion],
  [visaKind, visaQuestion],
  [vagueKind, vagueQuestion],
  [readingKind, readingQuestion],
];
const kinds = new Map(registrations.map(([kind]) => [kind.operation, kind]));
/** Identify recognized SYSTEM/schema shapes even when a transport omitted its action header. */
export function engineQuestion(body, persona) {
  for (const [_kind, identify] of registrations) { const question = identify(body, persona); if (question) return question; }
  return undefined;
}
/** Distinguish these engine item kinds from existing decide/place and independently registered desktop kinds. */
export const engineOperation = operation => kinds.has(operation);
/** Validate rows during loadTable, retaining the same text/answer item shape as decide. */
export const validEngineEntry = (operation, entry, key) => typeof entry?.text === 'string' && (kinds.get(operation).validEntry ? kinds.get(operation).validEntry(entry.answer, key) : kinds.get(operation).valid(entry.answer));
/** Compose the engine's wire response from reviewed items in the existing table. */
export const engineAnswerFor = (question, table) => engineBatchAnswer(kinds.get(question.operation), question, table);
/** Extract complete, validated per-item candidates for the existing recordCandidate writer. */
export const engineCandidates = (question, reply) => engineBatchCandidates(kinds.get(question.operation), question, reply);

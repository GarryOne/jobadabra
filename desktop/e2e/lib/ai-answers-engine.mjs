// Dispatch engine item kinds through questionOf and the existing single answer table.
// Job: serve stored answers
import {engineBatchAnswer, engineBatchCandidates} from './ai-answers-engine-items.mjs';
import {placesKind, placesQuestion} from './ai-answers-places.mjs';
import {geoKind, geoQuestion} from './ai-answers-geo.mjs';
import {titleKind, titleQuestion} from './ai-answers-title.mjs';
import {enrichKind, enrichQuestion} from './ai-answers-enrich.mjs';
import {visitKind, visitQuestion} from './ai-answers-visit.mjs';
import {visaKind, visaQuestion, vagueKind, vagueQuestion, readingKind, readingQuestion} from './ai-answers-place-extra.mjs';
import {decideCandidates, itemCandidateName} from './ai-answers-decide.mjs';
import {placeAnswerFor, placeCandidates, validPlaceAnswer} from './ai-answers-place.mjs';

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
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const namedCandidates = (items, prefix = '') => items.map(item => ({...item, name: itemCandidateName(`${prefix}${item.key}`)}));

function validateTextEntry(operation, entry, key) {
  if (typeof entry?.text !== 'string' || typeof entry?.answer !== 'string' || !entry.answer.trim()) throw new Error(`AI answers: ${operation}/${key} needs text and a non-empty answer`);
}

function validatePlaceEntry(operation, entry, key) {
  if (typeof entry?.text !== 'string' || !validPlaceAnswer(entry.answer)) throw new Error(`AI answers: ${operation}/${key} needs text and a valid place answer`);
}

function validateEngineEntry(kind, operation, entry, key) {
  if (!(typeof entry?.text === 'string' && (kind.validEntry ? kind.validEntry(entry.answer, key) : kind.valid(entry.answer)))) throw new Error(`AI answers: ${operation}/${key} needs text and a valid engine answer`);
}

function decideAnswerFor(question, table) {
  const results = [], allowed = question.context.allowedAnswers.split(', ');
  for (const item of question.items) {
    const entries = table.items?.['app.decide'];
    const entry = object(entries) && Object.hasOwn(entries, item.key) ? entries[item.key] : null;
    // Why (30 Oct 2026, qu; #2450 slice 3): moving decide dispatch preserves the requirement that every exact item has an allowed answer.
    if (!entry || entry.text !== item.text || !allowed.includes(entry.answer)) return {missing: `app.decide item ${item.index} ${JSON.stringify(item.text.slice(0, 80))} key ${item.key}`};
    results.push({index: item.index, answer: entry.answer});
  }
  return {data: {results}};
}

// Why (30 Oct 2026, qu): one operation registry owns validation, replay and recording; engine registrations add all three without new dispatch branches.
// Invariants: errors, response data and per-family candidate filename keys retain their existing bytes.
const operations = new Map([
  ...registrations.map(([kind]) => [kind.operation, {
    validate: (operation, entry, key) => validateEngineEntry(kind, operation, entry, key),
    answer: (question, table) => engineBatchAnswer(kind, question, table),
    candidates: (question, reply) => namedCandidates(engineBatchCandidates(kind, question, reply), `${question.operation}/`),
  }]),
  ['app.place', {validate: validatePlaceEntry, answer: placeAnswerFor, candidates: (question, reply) => namedCandidates(placeCandidates(question, reply))}],
  ['app.decide', {validate: validateTextEntry, answer: decideAnswerFor, candidates: (question, reply) => namedCandidates(decideCandidates(question, reply))}],
]);

/** Identify recognized SYSTEM/schema shapes even when a transport omitted its action header. */
export function engineQuestion(body, persona) {
  for (const [_kind, identify] of registrations) { const question = identify(body, persona); if (question) return question; }
  return undefined;
}
/** Find an item's shared validation, replay and candidate handlers, leaving complete replies to their existing path. */
export const itemOperation = operation => operations.get(operation);

/** Validate a table item with its registered contract or the existing generic text contract. */
export function validateItemEntry(operation, entry, key) {
  (operations.get(operation)?.validate ?? validateTextEntry)(operation, entry, key);
}

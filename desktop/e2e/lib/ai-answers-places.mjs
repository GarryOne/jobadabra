// Key the place-word expansion question independently of action labels and personas.
// Job: serve stored answers
import {S, invalid, itemQuestion, json, requestParts, responseSchema, sameSchema, valid} from './ai-answers-engine-items.mjs';

/** Match src/regions.py's comparable place-word form, including accents and regex word wrappers. */
export function normalizedPlace(text) {
  return text.replace(/\[([\p{L}\p{N}_])([\p{L}\p{N}_])\]/gu, (_all, a, b) => b.codePointAt(0) > 127 ? b : a)
    .replace(/\\b|\\|["']/g, '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-_/.]+/g, ' ').trim().replace(/\s+/g, ' ');
}
const row = S.object({countries: S.array(S.string), kind: S.enum(['country', 'region', 'state', 'city', 'other']), names: S.array(S.string)});
/** The per-word item contract, stored in the same items table as decide. */
export const placesKind = {operation: 'app.places', root: 'places', selector: 'word', row, noun: 'place word', valid: answer => valid(row, answer)};
/** Identify by the user marker and schema, accepting scout, places or absent action headers. */
export function placesQuestion(body) {
  const parts = requestParts(body);
  if (!parts.user.startsWith('Place words (JSON):')) return undefined;
  const words = json(parts.user.slice('Place words (JSON):'.length));
  if (!sameSchema(parts.schema, responseSchema(placesKind)) || !Array.isArray(words) || words.length < 1 || words.length > 12 || !words.every(word => typeof word === 'string' && normalizedPlace(word))) return invalid(placesKind.operation, 'expected place-word list and schema');
  const texts = words.map(normalizedPlace);
  if (new Set(texts).size !== texts.length) return invalid(placesKind.operation, 'ambiguous duplicate normalized place words');
  const question = itemQuestion(placesKind.operation, texts, {}, '', true);
  // Why (30 Oct 2026, supervisor): place expansion has no personal context; the normalized word itself is its table key.
  question.items = question.items.map((item, index) => ({...item, key: item.text, raw: words[index]}));
  return question;
}

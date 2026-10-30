// Replay visa, vague-location and posting-place questions reachable after location triage.
// Job: serve stored answers
import {S, invalid, itemQuestion, json, object, numbered, requestParts, responseSchema, sameSchema, valid, canonical} from './ai-answers-engine-items.mjs';
/** Per-country sponsorship judgments store negative answers explicitly. */
export const visaKind = {operation: 'app.visa', mode: 'selection', root: 'visa', selector: 'text', noun: 'country', valid: answer => typeof answer === 'boolean'};
/** Per-location vagueness judgments compose the request's selected numbers. */
export const vagueKind = {operation: 'app.placeVague', mode: 'selection', root: 'vague', noun: 'location', valid: answer => typeof answer === 'boolean'};
const row = S.object({where: S.string, nearest: S.string, km: S.integer, answer: S.enum(['best', 'inside', 'out', 'unclear'])});
/** Per-posting place facts omit only the request-local n. */
export const readingKind = {operation: 'app.placeReading', root: 'jobs', row, noun: 'posting', valid: answer => valid(row, answer)};
/** Identify the work-rights SYSTEM and key every country against that rights block. */
export function visaQuestion(body, persona) {
  const parts = requestParts(body);
  if (!parts.system.startsWith("You get a job seeker's work rights in their own words")) return undefined;
  const match = /^Their work rights: ([\s\S]+)\nCountries: ([\s\S]+)$/.exec(parts.user), rights = match && json(match[1]), countries = match && json(match[2]);
  if (!Array.isArray(rights) || !rights.every(value => typeof value === 'string') || !Array.isArray(countries) || !countries.length || !countries.every(value => typeof value === 'string' && value.trim()) || new Set(countries).size !== countries.length || !sameSchema(parts.schema, responseSchema(visaKind))) return invalid(visaKind.operation, 'expected rights, countries and visa schema');
  return itemQuestion(visaKind.operation, countries, {rights}, persona);
}
/** Identify the vague-location SYSTEM and key its numbered locations with the supplied places. */
export function vagueQuestion(body, persona) {
  const parts = requestParts(body);
  if (!parts.system.startsWith('You get a numbered list of job locations as postings write them.')) return undefined;
  const match = /^Their places \(JSON\): ([\s\S]+)\nThe job locations:\n([\s\S]+)$/.exec(parts.user), places = match && json(match[1]), texts = match && numbered(match[2], 60);
  if (!object(places) || !texts || !sameSchema(parts.schema, responseSchema(vagueKind))) return invalid(vagueKind.operation, 'expected places, numbered locations and vague schema');
  return itemQuestion(vagueKind.operation, texts, {places}, persona);
}
/** Identify posting-place reading and parse title, location and the exact text excerpt as semantic fields. */
export function readingQuestion(body, persona) {
  const parts = requestParts(body);
  if (!parts.system.startsWith('You decide where jobs are, for one job seeker, from the postings themselves:')) return undefined;
  const match = /^Their places \(JSON\): ([\s\S]+)\nThe postings:\n([\s\S]+)$/.exec(parts.user), places = match && json(match[1]);
  if (!object(places) || !sameSchema(parts.schema, responseSchema(readingKind))) return invalid(readingKind.operation, 'expected places, postings and reading schema');
  const blocks = match[2].split('\n\n');
  if (!blocks.length || blocks.length > 10) return invalid(readingKind.operation, 'expected 1 to 10 postings');
  const postings = blocks.map((block, index) => {
    const posting = /^([1-9]\d*)\. Title: ([^\n]+)\nLocation field: ([^\n]+)\nText: ([^\n]+)$/.exec(block);
    return posting && Number(posting[1]) === index + 1 ? {title: posting[2], location: posting[3], text: posting[4]} : null;
  });
  if (postings.some(posting => !posting)) return invalid(readingKind.operation, 'ambiguous posting block');
  const question = itemQuestion(readingKind.operation, postings.map(canonical), {places}, persona);
  question.items.forEach((item, index) => { item.label = postings[index].title; });
  return question;
}

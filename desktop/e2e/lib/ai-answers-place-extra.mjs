// Replay small engine families: work rights, location vagueness, posting places and mail classification.
// Job: serve stored answers
import {S, hash, invalid, itemQuestion, json, object, numbered, requestParts, responseSchema, sameSchema, valid, canonical} from './ai-answers-engine-items.mjs';
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

const mailRow = S.object({relevant: S.boolean, application: S.integer, company: S.string, role: S.string,
  kind: S.enum(['Confirmation received', 'Reply received', 'Interview scheduled', 'Rejected', 'Offer', 'Recruiter outreach', 'Other', 'Feedback received']),
  interview_at: S.string, interview_zone: S.string, summary: S.string, feedback: S.string});
/** Mail rows store the classifier's closed result shape without its request-local index. */
export const mailKind = {operation: 'mail', root: 'results', selector: 'index', row: mailRow, valid: answer => valid(mailRow, answer)};
/** Identify mail classification and key each sender/subject/body tuple independently of the fake clock. */
export function mailQuestion(body, persona) {
  const parts = requestParts(body);
  if (!parts.system.startsWith('You sort the job-search emails (and calendar events) of the owner of Jobadabra.')) return undefined;
  if (!sameSchema(parts.schema, responseSchema(mailKind))) return invalid('mail', 'expected closed classifier schema');
  const blocks = parts.user.trimStart().split(/\n\n(?=### Item )/), indexes = [], tuples = [];
  for (const block of blocks) {
    const match = /^### Item (\d+)\nFrom: ([^\n]*)\nDate: [^\n]*\nSubject: ([^\n]*)\n\n([\s\S]*)$/.exec(block);
    if (!match || !match[2].trim() || !match[3].trim()) return invalid('mail', 'expected Item block with From and Subject');
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || indexes.includes(index)) return invalid('mail', 'ambiguous item index');
    indexes.push(index); tuples.push({from: match[2].trim(), subject: match[3].trim(), body: match[4].trim()});
  }
  // Invariants: Date and batch index never enter the key; replay uses each current request's original index.
  const question = itemQuestion('mail', tuples.map(canonical), {}, persona);
  question.items = question.items.map((item, index) => ({...item, n: indexes[index], label: tuples[index].subject, key: `${persona || 'default'}/mail/${hash(item.text)}`}));
  return question;
}

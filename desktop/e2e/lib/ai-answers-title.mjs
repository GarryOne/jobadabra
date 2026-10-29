// Replay title sorting and its second-look question per title and search, with separate pass identities.
// Job: serve stored answers
import {invalid, itemQuestion, json, object, numbered, requestParts, responseSchema, sameSchema} from './ai-answers-engine-items.mjs';
/** Title selection stores explicit booleans, including negative answers omitted from the fit list. */
export const titleKind = {operation: 'app.title', root: 'fit', mode: 'selection', noun: 'title', valid: answer => typeof answer === 'boolean'};
/** Recognize both fixed title SYSTEM variants and parse their semantic search block. */
export function titleQuestion(body, persona) {
  const parts = requestParts(body), pass = parts.system.startsWith('You sort job titles for one job seeker.') ? 'sort' : parts.system.startsWith('You check job titles that a first sort rejected for one job seeker.') ? 'recheck' : '';
  if (!pass) return undefined;
  const match = /^The search \(JSON\): ([\s\S]+)\nThe titles:\n([\s\S]+)$/.exec(parts.user), search = match && json(match[1]), texts = match && numbered(match[2], 30);
  if (!object(search) || !['role_words', 'words_ruled_out'].every(key => Array.isArray(search[key]) && search[key].every(value => typeof value === 'string')) || !texts || !sameSchema(parts.schema, responseSchema(titleKind))) return invalid(titleKind.operation, 'expected search JSON, numbered titles and fit schema');
  return itemQuestion(titleKind.operation, texts, {search, pass}, persona);
}

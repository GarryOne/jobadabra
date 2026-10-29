// Parse place-triage batches and validate location answers independently of prompt wording.
// Job: serve stored answers
// Invariants: exact locations and persona/places identify items; numbering is request-local; invalid replies record nothing.
import {createHash} from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_key, part) => object(part) ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);
const sha = text => createHash('sha256').update(text).digest('hex');
const textOf = value => typeof value === 'string' ? value : Array.isArray(value) && value.every(part => object(part) && ['text', 'input_text'].includes(part.type) && typeof part.text === 'string') ? value.map(part => part.text).join('\n') : '';
const unkeyable = reason => ({unkeyable: `app.place: ${reason}`});
const fields = {where: 'string', country: 'string', nearest: 'string', km: 'integer', answer: 'string'};
const verdicts = ['best', 'inside', 'out'];
const sameKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function placeSchema(schema) {
  const row = schema?.properties?.locations?.items, types = {n: 'integer', ...fields};
  return schema?.type === 'object' && schema.additionalProperties === false &&
    Array.isArray(schema.required) && schema.required.length === 1 && schema.required[0] === 'locations' &&
    sameKeys(schema.properties, ['locations']) && schema.properties.locations.type === 'array' &&
    row?.type === 'object' && row.additionalProperties === false && sameKeys(row.properties, Object.keys(types)) &&
    Array.isArray(row.required) && row.required.length === 6 && Object.keys(types).every(key => row.required.includes(key) && row.properties[key]?.type === types[key]) &&
    Array.isArray(row.properties.answer.enum) && row.properties.answer.enum.length === 3 && verdicts.every(value => row.properties.answer.enum.includes(value));
}

/** Accept the engine's stored answer fields only, excluding the batch-local n. */
export function validPlaceAnswer(answer) {
  return sameKeys(answer, Object.keys(fields)) && ['where', 'country', 'nearest'].every(key => typeof answer[key] === 'string') && Number.isInteger(answer.km) && verdicts.includes(answer.answer);
}

/** Parse the engine's numbered location ask, shared by Anthropic and translated Responses requests. */
export function placeQuestion(body, persona) {
  if (!object(body) || !textOf(body.system ?? body.instructions).startsWith('You decide where job postings are, for one job seeker.')) return unkeyable('missing recognised system prefix');
  if (!placeSchema(body.output_config?.format?.schema ?? body.text?.format?.schema)) return unkeyable('missing place-triage schema');
  const messages = body.messages ?? body.input;
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user') return unkeyable('expected one user message');
  const match = /^Their places \(JSON\): ([\s\S]+)\nThe job locations:\n([\s\S]+)$/.exec(textOf(messages[0].content));
  if (!match) return unkeyable('expected places JSON and numbered job locations');
  let places;
  try { places = JSON.parse(match[1]); } catch { return unkeyable('invalid places JSON'); }
  if (!object(places) || !['best_places', 'anywhere_in', 'cities_abroad', 'remote_limited_to_regions_they_cannot_work_from'].every(key => Array.isArray(places[key]) && places[key].every(value => typeof value === 'string')) || !['yes', 'no'].includes(places.remote_jobs)) return unkeyable('invalid places block');
  const lines = match[2].split('\n');
  if (!lines.length || lines.length > 30) return unkeyable('expected 1 to 30 location lines');
  // Why (29 Oct 2026, owner): the same location changes meaning with the user's places and persona, never with neighbours,
  // model or prompt bytes. Canonical JSON normalizes serialization only; 12 hex digits version places while exact text keeps its full hash.
  const version = sha(canonical(places)).slice(0, 12), items = [];
  for (const [index, line] of lines.entries()) {
    const location = /^([1-9]\d*)\. ([^\r\n]+)$/.exec(line);
    if (!location || Number(location[1]) !== index + 1 || !location[2].trim()) return unkeyable('ambiguous location line or non-consecutive numbering');
    const text = location[2];
    items.push({n: Number(location[1]), text, key: `${persona || 'default'}/places-${version}/${sha(text)}`});
  }
  return {operation: 'app.place', items};
}

/** Compose a batch in request order, refusing the first absent or invalid exact location. */
export function placeAnswerFor(question, table) {
  const locations = [], entries = table.items?.['app.place'];
  for (const item of question.items) {
    const entry = object(entries) && Object.hasOwn(entries, item.key) ? entries[item.key] : null;
    if (!entry || entry.text !== item.text || !validPlaceAnswer(entry.answer)) return {missing: `app.place location ${JSON.stringify(item.text)} key ${item.key}`};
    const {where, country, nearest, km, answer} = entry.answer;
    locations.push({n: item.n, where, country, nearest, km, answer});
  }
  return {data: {locations}};
}

/** Extract all candidates from a complete valid reply; partial, duplicate or malformed batches keep nothing. */
export function placeCandidates(question, reply) {
  if (reply.stop_reason && reply.stop_reason !== 'end_turn' || reply.status && reply.status !== 'completed') return [];
  const text = reply.output_text ?? (reply.content || (reply.output || []).flatMap(item => item.content || [])).filter(part => ['text', 'output_text'].includes(part.type)).map(part => part.text || '').join('');
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (!sameKeys(data, ['locations']) || !Array.isArray(data.locations) || data.locations.length !== question.items.length) return [];
  const found = new Map(), numbers = new Set(question.items.map(item => item.n));
  for (const row of data.locations) {
    if (!sameKeys(row, ['n', ...Object.keys(fields)]) || !Number.isInteger(row.n) || !numbers.has(row.n) || found.has(row.n)) return [];
    const {n, ...answer} = row;
    if (!validPlaceAnswer(answer)) return [];
    found.set(n, answer);
  }
  return question.items.map(item => ({...item, answer: found.get(item.n)}));
}

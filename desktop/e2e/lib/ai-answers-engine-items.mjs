// Shared item-table plumbing for the engine's typed batch questions, not a second answer store.
// Job: serve stored answers
// Invariants: question content determines keys; request-local numbers never enter stored answers; invalid batches record nothing.
import {createHash} from 'node:crypto';

/** JSON object predicate shared by engine question parsers. */
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Canonicalize semantic objects without depending on JSON serialization whitespace or key order. */
export const canonical = value => JSON.stringify(value, (_key, part) => object(part) ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);
/** Hash semantic item/context values, never an assembled prompt. */
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
/** Read strict provider text blocks without accepting malformed or non-text parts. */
export const textOf = value => typeof value === 'string' ? value : Array.isArray(value) && value.every(part => object(part) && ['text', 'input_text'].includes(part.type) && typeof part.text === 'string') ? value.map(part => part.text).join('\n') : '';
/** Extract a single user turn and its SYSTEM and schema from either provider's wire shape. */
export function requestParts(body) {
  const messages = body?.messages ?? body?.input;
  return {system: textOf(body?.system ?? body?.instructions), schema: body?.output_config?.format?.schema ?? body?.text?.format?.schema,
    user: Array.isArray(messages) && messages.length === 1 && messages[0]?.role === 'user' ? textOf(messages[0].content) : ''};
}
/** Fixed JSON schema constructors for engine answer contracts. */
export const S = {
  string: {type: 'string'}, integer: {type: 'integer'}, number: {type: 'number'}, boolean: {type: 'boolean'},
  enum: values => ({type: 'string', enum: values}), array: items => ({type: 'array', items}),
  object: properties => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties}),
};
const shape = schema => {
  if (!object(schema)) return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !['description', 'title'].includes(key)).map(([key, value]) => [key,
    key === 'properties' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) : key === 'items' ? shape(value) : ['required', 'enum'].includes(key) && Array.isArray(value) ? [...value].sort() : value]));
};
/** Match contract shape, excluding prose descriptions and property/enum ordering. */
export const sameSchema = (actual, expected) => canonical(shape(actual)) === canonical(shape(expected));
/** Validate values against the closed, finite JSON schema subset these engine contracts use. */
export function valid(schema, value) {
  if (!schema) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') return object(value) && (schema.required || []).every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && valid(schema.properties[key], value[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.every(item => valid(schema.items, item));
  if (schema.type === 'integer') return Number.isInteger(value);
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === schema.type;
}
/** Rebuild an answer in the engine's declared property order. */
export function ordered(schema, value) {
  if (schema.type === 'object') return Object.fromEntries(Object.keys(schema.properties).filter(key => Object.hasOwn(value, key)).map(key => [key, ordered(schema.properties[key], value[key])]));
  return schema.type === 'array' ? value.map(item => ordered(schema.items, item)) : value;
}
/** Name recognized malformed questions rather than silently handing them to a live model. */
export const invalid = (operation, reason) => ({unkeyable: `${operation}: ${reason}`});
/** Parse exactly the numbered, single-line list emitted by the engine. */
export function numbered(text, max = Infinity) {
  const lines = text.split('\n');
  if (!lines.length || lines.length > max) return null;
  const result = [];
  for (const [index, line] of lines.entries()) {
    const match = /^([1-9]\d*)\. ([^\r\n]+)$/.exec(line);
    if (!match || Number(match[1]) !== index + 1 || !match[2].trim()) return null;
    result.push(match[2]);
  }
  return result;
}
/** Construct per-item questions with an explicit semantic context and persona boundary. */
export function itemQuestion(operation, texts, context, persona, shared = false) {
  // Why (30 Oct 2026, owner): list order and neighbours are transport details; a search/policy change is a different judgment.
  const prefix = `${shared ? 'shared' : persona || 'default'}/${operation}/${hash(context).slice(0, 12)}`;
  return {operation, items: texts.map((text, index) => ({n: index + 1, text, key: `${prefix}/${hash(text)}`}))};
}
/** Parse JSON safely; malformed blocks remain unkeyable. */
export function json(text) { try { return JSON.parse(text); } catch { return undefined; } }
/** Decode only completed provider replies, without accepting partial or refused answers. */
export function replyData(reply) {
  if (reply.stop_reason && reply.stop_reason !== 'end_turn' || reply.status && reply.status !== 'completed') return undefined;
  const blocks = reply.content ?? (Array.isArray(reply.output) ? reply.output.flatMap(item => item?.content || []) : []);
  const text = reply.output_text ?? (Array.isArray(blocks) ? blocks.filter(part => ['text', 'output_text'].includes(part?.type)).map(part => part.text || '').join('') : '');
  return json(text);
}
/** Produce the provider schema for a numbered, word-keyed, selected or single-item kind. */
export function responseSchema(kind, question) {
  if (kind.mode === 'single') return question.responseSchema;
  if (kind.mode === 'selection') return S.object({[kind.root]: S.array(kind.selector === 'text' ? S.string : S.integer)});
  return S.object({[kind.root]: S.array(S.object({[kind.selector || 'n']: kind.selector === 'word' ? S.string : S.integer, ...kind.row.properties}))});
}
/** Compose a batch only when every exact item has a valid reviewed row. */
export function engineBatchAnswer(kind, question, table) {
  const answers = [], entries = table.items?.[question.operation];
  for (const item of question.items) {
    const entry = object(entries) && Object.hasOwn(entries, item.key) ? entries[item.key] : null;
    if (!entry || entry.text !== item.text || !kind.valid(entry.answer) || kind.mode === 'single' && !valid(question.responseSchema, entry.answer)) return {missing: `${question.operation} ${kind.noun || 'item'} ${JSON.stringify(item.label || item.text)} key ${item.key}`};
    answers.push(entry.answer);
  }
  if (kind.mode === 'single') return {data: ordered(question.responseSchema, answers[0])};
  if (kind.mode === 'selection') return {data: {[kind.root]: question.items.filter((_item, index) => answers[index]).map(item => kind.selector === 'text' ? item.text : item.n)}};
  return {data: {[kind.root]: question.items.map((item, index) => ({[kind.selector || 'n']: kind.selector === 'word' ? item.raw : item.n, ...ordered(kind.row, answers[index])}))}};
}
/** Validate an entire live batch before exposing any per-item review candidate. */
export function engineBatchCandidates(kind, question, reply) {
  const data = replyData(reply), schema = responseSchema(kind, question);
  if (!valid(schema, data)) return [];
  let answers;
  if (kind.mode === 'single') answers = [data];
  else if (kind.mode === 'selection') {
    const choices = data[kind.root], identifiers = question.items.map(item => kind.selector === 'text' ? item.text : item.n);
    if (new Set(choices).size !== choices.length || choices.some(value => !identifiers.includes(value))) return [];
    answers = identifiers.map(value => choices.includes(value));
  } else {
    const rows = data[kind.root], found = new Map(), selector = kind.selector || 'n';
    if (rows.length !== question.items.length) return [];
    for (const row of rows) {
      const identity = row[selector];
      if (found.has(identity) || !question.items.some(item => (selector === 'word' ? item.raw : item.n) === identity)) return [];
      const answer = Object.fromEntries(Object.entries(row).filter(([key]) => key !== selector));
      if (!kind.valid(answer)) return [];
      found.set(identity, answer);
    }
    answers = question.items.map(item => found.get(selector === 'word' ? item.raw : item.n));
  }
  if (!answers.every(answer => kind.valid(answer))) return [];
  return question.items.map((item, index) => ({...item, answer: answers[index]}));
}

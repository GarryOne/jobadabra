// Parse batched decide requests and validate per-item answers without guessing identity.
// Job: serve stored answers
// Invariants: keys retain exact context/text; ambiguous layouts refuse; invalid batches record nothing.
import {createHash} from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_key, part) => object(part) ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);
const sha = text => createHash('sha256').update(text).digest('hex');
const textOf = value => typeof value === 'string' ? value : Array.isArray(value) && value.every(part => object(part) && ['text', 'input_text'].includes(part.type) && typeof part.text === 'string') ? value.map(part => part.text).join('\n') : '';
const unkeyable = reason => ({unkeyable: `decide: ${reason}`});

/** Parse only the engine's decide layout; item text and context retain their exact bytes. */
export function decideQuestion(body, persona) {
  if (!object(body)) return unkeyable('expected a request object');
  if (!textOf(body.system ?? body.instructions).startsWith('You decide what short pieces of content mean')) return unkeyable('missing recognised system prefix');
  const messages = body.messages ?? body.input;
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user') return unkeyable('expected one user message');
  const match = /^Task: ([\s\S]+)\nAllowed answers: ([^\n]+)\n\n([\s\S]+)$/.exec(textOf(messages[0].content));
  if (!match || !match[1].trim()) return unkeyable('expected Task, Allowed answers and item blocks');
  const [, task, allowedAnswers, blocks] = match, schema = body.output_config?.format?.schema ?? body.text?.format?.schema;
  const allowed = allowedAnswers.split(', '), enumValues = schema?.properties?.results?.items?.properties?.answer?.enum;
  if (!object(schema) || !Array.isArray(enumValues) || !allowed.every(value => value.trim() && enumValues.includes(value)) ||
      allowed.length !== enumValues.length || new Set(allowed).size !== allowed.length) return unkeyable('missing schema or inconsistent allowed answers');
  const context = {task, allowedAnswers, schema}, contextSHA = sha(canonical(context));
  const markers = [...blocks.matchAll(/^### Item [^\n]*(?:\n|$)/gm)];
  // Why (#2450 slice 3): accept only batches the engine can actually send, rather than keying malformed asks.
  if (!markers.length || markers.length > 50 || markers[0].index !== 0) return unkeyable('expected 1 to 50 item blocks');
  const items = [];
  for (const [index, marker] of markers.entries()) {
    // Why (#2450 slice 3): the engine never escapes delimiters, so malformed or embedded markers must refuse rather than guess an item boundary.
    if (marker[0] !== `### Item ${index}\n` || (index && blocks.slice(marker.index - 2, marker.index) !== '\n\n')) return unkeyable('ambiguous item delimiter or non-consecutive indexes');
    const text = blocks.slice(marker.index + marker[0].length, index + 1 < markers.length ? markers[index + 1].index - 2 : blocks.length);
    if (Array.from(text).length > 600) return unkeyable('item exceeds the engine text limit');
    // Why (#2450 slice 3): identical words can mean different things across tasks and personas; batch positions and neighbours never identify an item.
    items.push({index, text, key: `${persona || 'default'}/${contextSHA}/${sha(text)}`});
  }
  return {operation: 'app.decide', context, items};
}

/** Return every validated item candidate, or none; index order in a live reply is immaterial. */
export function decideCandidates(question, reply) {
  if (reply.stop_reason && reply.stop_reason !== 'end_turn' || reply.status && reply.status !== 'completed') return [];
  const text = reply.output_text ?? (reply.content || (reply.output || []).flatMap(item => item.content || [])).filter(part => ['text', 'output_text'].includes(part.type)).map(part => part.text || '').join('');
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (!object(data) || Object.keys(data).length !== 1 || !Array.isArray(data.results) || data.results.length !== question.items.length) return [];
  const found = new Map(), allowed = question.context.allowedAnswers.split(', ');
  for (const result of data.results) {
    // Why (#2450 slice 3): a partial, duplicate or out-of-contract live answer must never leave even one review candidate.
    if (!object(result) || Object.keys(result).length !== 2 || !Number.isInteger(result.index) || result.index < 0 || result.index >= question.items.length || found.has(result.index) || !allowed.includes(result.answer)) return [];
    found.set(result.index, result.answer);
  }
  return question.items.map(item => ({...item, answer: found.get(item.index)}));
}

/** Give each item a filesystem-safe candidate name covering persona, context and text. */
export const itemCandidateName = key => `ai-answers-item-${sha(key)}.json`;

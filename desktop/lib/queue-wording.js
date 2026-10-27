// The one question writer of the review queue (owner, 27 Oct 2026: "a pool of questions being dynamically generated out of the missing details"; the six base facts
// "Yes, write them too"): ONE AI call words a short question and a hint for each field it is given, kept in settings under the caller's key per signature, so a set is
// worded once. Callers: lib/contact-review.js (the empty contact fields, also rated 0-3 and checked against the saved lines) and lib/missing-facts.js wording (the base
// facts of lib/fact-catalog.js). The code only validates the shape; no AI or a failed call returns null and the caller asks by the field's own name. No typed question
// text anywhere. Guarded by test/queue-wording.test.js (the class loop) and test/contact-review.test.js.
import {MODEL} from './question-reuse.js';

const ITEM = {field: {type: 'string'}, question: {type: 'string'}, hint: {type: 'string'}};
const RATED = {...ITEM, importance: {type: 'integer', enum: [0, 1, 2, 3]}, held: {type: 'boolean'}};
const schemaOf = rated => {
  const properties = rated ? RATED : ITEM;
  return {type: 'object', additionalProperties: false, required: ['asks'], properties: {asks: {type: 'array', items: {type: 'object', additionalProperties: false, required: Object.keys(properties), properties}}}};
};

const clean = (raw, keys, rated) => {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap(each => {
    const field = String(each?.field || ''), question = String(each?.question || '').trim().slice(0, 160);
    if (!keys.includes(field) || seen.has(field) || !question) return [];
    seen.add(field);
    const out = {field, question, hint: String(each?.hint || '').trim().slice(0, 120)};
    return [rated ? {...out, importance: [0, 1, 2, 3].includes(each?.importance) ? each.importance : 1, held: each?.held === true} : out];
  });
};

// fields: [{key, label}] sent as "<tag>key: label</tag>"; extra: more of the user message (the saved lines, the language). -> [{field, question, hint, (importance, held)}] or null.
export async function written(storage, {cache, sig, system, tag, fields, extra = '', client, rated = false, maxTokens = 1500}) {
  const kept = storage.settings()[cache];
  if (kept?.sig === sig && kept.asks?.length) return kept.asks;
  if (!client || !fields.length) return null;
  try {
    const response = await client.messages.create({model: MODEL, max_tokens: maxTokens, system, output_config: {format: {type: 'json_schema', schema: schemaOf(rated)}, effort: 'low'},
      messages: [{role: 'user', content: `<${tag}>\n${fields.map(each => `${each.key}: ${each.label}`).join('\n')}\n</${tag}>${extra}`}]});
    const list = clean(JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').asks, fields.map(each => each.key), rated);
    if (list.length) storage.saveSettings({[cache]: {sig, asks: list}});
    return list.length ? list : null;
  } catch { return null; }   // tried again at the next list
}

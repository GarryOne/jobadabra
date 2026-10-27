// The empty fields of Your details → Contact details as a pool of queue questions, generated, never typed (owner, 27 Oct 2026: "This should not be hard-coded. There
// should be a pool of questions being dynamically generated out of the missing details in Profile"; "if the app doesn't know my first and last name, it should be the first
// question"; "if the user does have already these details, how are we asking him again?"). Item kind "contact" of lib/details-review.js. The fields are the schema
// (lib/contact.js LABELS); ONE AI call per set of empty fields writes each question in the person's language, rates how many applications need it (importance 0-3: 3 = nearly
// every form, 0 = not worth asking) and drops a field the saved lines already answer under another wording ("Mobile" answers Phone). Kept per set (settings.contactAsks), so
// a Profile is read once. The weight is that importance, raised by what forms measurably asked (renderer/question-filter.js factScore). No AI: the first four empty fields' own labels, in the
// schema's order. Guarded by test/details-review.test.js (the class loop) and test/contact-review.test.js.
import * as contactDetails from './contact.js';
import {MODEL} from './question-reuse.js';
import {BLOCKED, MUST} from '../renderer/question-filter.js';

const FLOOR = 4;   // with no AI at all: the first four empty fields of the schema's order (first name, last name, email, phone), never a rating of ours
const NEVER = new Set(['full_name']);   // made from first + last name on Save
const SCHEMA = {type: 'object', additionalProperties: false, required: ['asks'], properties: {asks: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['field', 'question', 'hint', 'importance', 'held'], properties: {field: {type: 'string'}, question: {type: 'string'}, hint: {type: 'string'}, importance: {type: 'integer', enum: [0, 1, 2, 3]}, held: {type: 'boolean'}}}}}};
const INSTRUCTIONS = `An applicant's contact details are missing the fields in <empty> (field: label). <lines> are the labels of what they already saved on their Profile and details.
For each empty field write the short question to ask them (their language; <language> when given, else English), a hint of a few words, and importance: 3 = nearly every application form requires it,
2 = many forms ask it, 1 = some forms ask it, 0 = not worth asking. held = true when a saved line already answers that field under another wording (a line "Mobile" answers phone).`;

// The weight a queue row takes from an importance: 3 outranks every blocked fill, 2 ranks right after them, 1 below any asked fact.
export const weightOf = importance => (importance >= 3 ? MUST : importance === 2 ? BLOCKED - 500 : importance === 1 ? 1 : 0);

// The empty contact fields, in the schema's order. -> [key]
export async function emptyKeys(storage, {fetcher} = {}) {
  const contact = await contactDetails.read(storage, fetcher);
  return Object.keys(contactDetails.LABELS).filter(key => !NEVER.has(key) && !String(contact[key] || '').trim());
}

const clean = (raw, keys) => {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap(each => {
    const field = String(each?.field || ''), question = String(each?.question || '').trim().slice(0, 160);
    if (!keys.includes(field) || seen.has(field) || !question) return [];
    seen.add(field);
    return [{field, question, hint: String(each?.hint || '').trim().slice(0, 120), importance: [0, 1, 2, 3].includes(each?.importance) ? each.importance : 1, held: each?.held === true}];
  });
};

// The questions for the empty fields, from the AI once per set (kept), else the labels. have: labels of the lines already saved. -> [{field, question, hint, importance}]
export async function asks(storage, keys, {client, have = [], language = ''} = {}) {
  const sig = [...keys, '|', ...[...new Set(have.map(label => String(label).trim()).filter(Boolean))].sort()].join('~');
  const kept = storage.settings().contactAsks;
  let list = kept?.sig === sig ? kept.asks : null;
  if (!list && client && keys.length) {
    try {
      const response = await client.messages.create({model: MODEL, max_tokens: 1500, system: INSTRUCTIONS, output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'},
        messages: [{role: 'user', content: `<empty>\n${keys.map(key => `${key}: ${contactDetails.LABELS[key]}`).join('\n')}\n</empty>\n<lines>\n${JSON.stringify(have).slice(0, 6000)}\n</lines>${language ? `\n<language>${language}</language>` : ''}`}]});
      list = clean(JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').asks, keys);
      if (list.length) storage.saveSettings({contactAsks: {sig, asks: list}});
    } catch { list = null; }   // tried again at the next list
  }
  if (!list?.length) return keys.slice(0, FLOOR).map(key => ({field: key, question: contactDetails.LABELS[key], hint: '', importance: 3}));   // no AI: the first fields of the schema, by their label
  return list.filter(each => !each.held && each.importance > 0);
}

// The person's answer into its field; nothing else in the details changes. -> {ok, homeName, error}
export async function answer(storage, field, value, {fetcher} = {}) {
  const given = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!contactDetails.LABELS[field] || NEVER.has(field)) return {ok: false, error: 'That question is no longer open'};
  if (!given) return {ok: false, error: 'Type the answer'};
  await contactDetails.save(storage, {...await contactDetails.read(storage, fetcher), [field]: given}, fetcher);
  return String((await contactDetails.read(storage, fetcher))[field] || '').trim() ? {ok: true, homeName: 'Your details → Contact details'} : {ok: false, error: 'It did not save; nothing else changed'};
}

export const format = {kind: 'text', list: '', options: [], constraints: false, control: 'text'};

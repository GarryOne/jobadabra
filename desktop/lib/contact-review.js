// The empty fields of Your details → Contact details as a pool of queue questions, generated, never typed (owner, 27 Oct 2026: "This should not be hard-coded. There
// should be a pool of questions being dynamically generated out of the missing details in Profile"; "if the app doesn't know my first and last name, it should be the first
// question"; "if the user does have already these details, how are we asking him again?"). Item kind "contact" of lib/details-review.js. The fields are the schema
// (lib/contact.js LABELS); ONE AI call per set of empty fields (lib/queue-wording.js, the queue's one question writer) writes each question in the person's language, rates
// how many applications need it (importance 0-3: 3 = nearly every form, 0 = not worth asking) and drops a field the saved lines already answer under another wording
// ("Mobile" answers Phone). Kept per set (settings.contactAsks), so a Profile is read once. The weight is that importance, raised by what forms measurably asked
// (renderer/question-filter.js factScore). The same wording asks a contact value the CV proposes (lib/cv-queue.js). No AI: the first four empty fields' own labels, in the
// schema's order. Guarded by test/details-review.test.js (the class loop), test/contact-review.test.js and test/queue-wording.test.js.
import * as contactDetails from './contact.js';
import {written} from './queue-wording.js';
import {BLOCKED, MUST} from '../renderer/question-filter.js';

const FLOOR = 4;   // with no AI at all: the first four empty fields of the schema's order (first name, last name, email, phone), never a rating of ours
const NEVER = new Set(['full_name']);   // made from first + last name on Save
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

// The AI's list for this set of empty fields (kept), or null. have: labels of the lines already saved.
const generated = (storage, keys, {client, have = [], language = ''} = {}) => written(storage, {cache: 'contactAsks', system: INSTRUCTIONS, tag: 'empty', client, rated: true,
  sig: [...keys, '|', ...[...new Set(have.map(label => String(label).trim()).filter(Boolean))].sort()].join('~'),
  fields: keys.map(key => ({key, label: contactDetails.LABELS[key]})),
  extra: `\n<lines>\n${JSON.stringify(have).slice(0, 6000)}\n</lines>${language ? `\n<language>${language}</language>` : ''}`});

// The questions to ask for the empty fields, from the AI once per set (kept), else the labels. except: fields asked elsewhere (a CV proposal). -> [{field, question, hint, importance}]
export async function asks(storage, keys, {except = new Set(), ...options} = {}) {
  const list = await generated(storage, keys, options);
  if (!list?.length) return keys.filter(key => !except.has(key)).slice(0, FLOOR).map(key => ({field: key, question: contactDetails.LABELS[key], hint: '', importance: 3}));   // no AI: the first fields of the schema, by their label
  return list.filter(each => !each.held && each.importance > 0 && !except.has(each.field));
}

// The same wording by field, for a contact value the CV proposes. -> Map field -> {question, hint}; a field the AI did not word is absent (asked by its label).
export async function wordsFor(storage, keys, options = {}) {
  return new Map((await generated(storage, keys, options) || []).map(each => [each.field, {question: each.question, hint: each.hint}]));
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

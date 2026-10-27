// The must-have contact details as items of the one review queue (owner, 27 Oct 2026: "if the app doesn't know my first and last name, it should be the first
// question here in the queue"): first + last name (one question), email and phone, whichever Your details still lacks. Every form asks them, so they rank above
// everything (renderer/question-filter.js MUST). Item kind "contact" of lib/details-review.js; answer() saves into 📇 Contact details (lib/contact.js).
// Guarded by test/details-review.test.js (the class loop) and test/contact-review.test.js.
import * as contactDetails from './contact.js';

export const MUST_HAVE = ['name', 'email', 'phone'];
const ASKS = {
  name: {question: 'What are your first and last name?', hint: 'Forms ask for it first', fact: 'Name', keys: ['first_name', 'last_name']},
  email: {question: 'What is your email address?', hint: 'Forms and employers write to it', fact: 'Email', keys: ['email']},
  phone: {question: 'What is your phone number?', hint: 'With its country code', fact: 'Phone', keys: ['phone']},
};
const text = {kind: 'text', list: '', options: [], constraints: false, control: 'text'};

// The must-haves Your details lacks, in order. -> [{id, question, hint, fact, value (what is known of it)}]
export async function missing(storage, {fetcher} = {}) {
  const contact = await contactDetails.read(storage, fetcher);
  return MUST_HAVE.map(id => ({id, ...ASKS[id], value: ASKS[id].keys.map(key => contact[key] || '').join(' ').trim()}))
    .filter(each => ASKS[each.id].keys.some(key => !String(contact[key] || '').trim()));
}

// The person's answer: the name is split on its last space; the rest is one field. Nothing else in the details changes. -> {ok, homeName, error}
export async function answer(storage, id, value, {fetcher} = {}) {
  const ask = ASKS[id], given = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!ask) return {ok: false, error: 'That question is no longer open'};
  if (!given) return {ok: false, error: 'Type the answer'};
  const contact = await contactDetails.read(storage, fetcher);
  const fields = id === 'name' ? (() => {
    const at = given.lastIndexOf(' ');
    return at < 0 ? null : {first_name: given.slice(0, at), last_name: given.slice(at + 1), full_name: given};
  })() : {[ask.keys[0]]: given};
  if (!fields) return {ok: false, error: 'Type your first and last name'};
  await contactDetails.save(storage, {...contact, ...fields}, fetcher);
  const back = await contactDetails.read(storage, fetcher);
  return ask.keys.every(key => String(back[key] || '').trim()) ? {ok: true, homeName: 'Your details → Contact details'} : {ok: false, error: 'It did not save; nothing else changed'};
}

export const format = text;

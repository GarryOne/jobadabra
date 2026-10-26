// What you answered yourself in a form: the extension reads the fields YOU changed at the Submit press (extension/review.js)
// and sends them here, so no form asks the same thing twice.
//   - a personal fact (street, postal code, place of origin, date of birth) -> Your details (the Notion Profile), only
//     when that detail is still empty, so a value you already keep is never overwritten;
//   - anything else short -> 🧠 Form knowledge (Notion) as an "answer"/"option" note for every site, which the extension
//     uses on the next form that asks the same question (lib/server.js me() -> extension/flow.js).
// Nothing leaves your Notion. You can read, fix or delete every line there.
import {asksQuestion} from './label-shape.js';
import {aliasKey} from '../shared/alias-schema.js';
import * as sharedMeanings from './aliases.js';
import * as contactDetails from './contact.js';
import * as knowledge from './knowledge.js';
import * as notionGate from './notion-gate.js';
import {log} from './log.js';

const PERSONAL = [
  ['street', /^(street(\s*address)?|strasse|stra\u00dfe|rue|address(\s*line\s*1)?)$/i],
  ['postal_code', /\b(npa|postal\s*code|post\s*code|zip(\s*code)?|plz|code postal)\b/i],
  ['place_of_origin', /place\s*of\s*origin|heimatort|lieu d.origine/i],
  ['birth_date', /date\s*of\s*birth|birth\s*date|birthday|geburtsdatum|date de naissance|\bdob\b/i],
];
// Already filled from Your details on every form.
const KNOWN = /first\s*name|last\s*name|family\s*name|surname|e-?mail|phone|mobile|linked\s*in|github|website|^\s*(full\s*)?name\s*$/i;
const clean = text => String(text || '').replace(/\s*\*+\s*$/, '').replace(/[:"\n]+/g, ' ').replace(/\s+/g, ' ').trim();
// The label meanings shared by every install (the alias pack: "Rua", "Código postal" in any language, learned) first, then these words.
const PERSONAL_KEYS = PERSONAL.map(([key]) => key), CONTACT_KEYS = ['first_name', 'last_name', 'full_name', 'email', 'phone', 'linkedin', 'github', 'website'];
export const personalKey = (label, aliases = []) => (key => (PERSONAL_KEYS.includes(key) ? key : ''))(aliasKey(clean(label), aliases))
  || PERSONAL.find(([, pattern]) => pattern.test(clean(label)))?.[0] || '';
const known = (label, aliases = []) => (!asksQuestion(label) && KNOWN.test(label)) || CONTACT_KEYS.includes(aliasKey(label, aliases));

// items [{label, value, kind}] -> {details: {street: ...}, notes: [...]}; what is already known is left out.
export function plan(items, {contact = {}, notes = [], aliases = []} = {}) {
  const details = {}, fresh = [];
  const have = new Map(notes.map(note => [`${note.scope}|${String(note.field).toLowerCase()}`, note.value]));
  for (const item of Array.isArray(items) ? items : []) {
    const label = clean(item?.label), value = clean(item?.value);
    if (label.length < 2 || !value || value.length > 300 || known(label, aliases)) continue;
    const key = personalKey(label, aliases);
    if (key) { if (!contact[key]) details[key] = value; continue; }
    if (have.get(`any|${label.toLowerCase()}`) === value) continue;
    fresh.push({scope: 'any', field: label, kind: item.kind === 'option' ? 'option' : 'answer', value, note: 'You entered this yourself'});
  }
  return {details, notes: fresh};
}

export async function save(storage, payload, {notify = () => {}, contactSaved = () => {}, fetcher} = {}) {
  try {
    const contact = await contactDetails.read(storage, fetcher).catch(() => ({}));
    const existing = await knowledge.notes(storage, fetcher).catch(() => []);
    const aliases = await sharedMeanings.lookup(storage).catch(() => []);   // the shared label meanings (cached; none with technical reports off)
    const {details, notes} = plan(payload?.items, {contact, notes: existing, aliases});
    if (Object.keys(details).length) { const merged = await contactDetails.save(storage, {...contact, ...details}, fetcher); contactSaved(merged); }
    if (notes.length) await knowledge.add(storage, notes, fetcher);
    const count = Object.keys(details).length + notes.length;
    // Decisions, not content: how many, and which kind, never the values (lib/log.js).
    log('learned', `kept ${count} answer(s) you entered yourself: ${Object.keys(details).length} to your details, ${notes.length} to Form knowledge`,
      {host: String(payload?.host || '').slice(0, 80), details: Object.keys(details)});
    if (count) notify(`Remembered ${count} answer${count === 1 ? '' : 's'}`, `Next forms that ask the same will be filled for you. Read or fix them in Settings → Profile → Form knowledge${notionGate.notionInUse(storage) ? ' and your Notion Form knowledge' : ''}.`, {view: 'settings', section: 'profile'}, 'good');   // about Notion
    return {ok: true, count};
  } catch (error) {
    log('learned', `could not keep the answers: ${error.message}`);
    return {ok: false, error: error.message};
  }
}

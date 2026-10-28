// What you answered yourself in a form: the extension reads the fields YOU changed at the Submit press (extension/review.js)
// and sends them here, so no form asks the same thing twice.
//   - a personal fact (street, postal code, place of origin, date of birth) -> Your details (the Notion Profile), only
//     when that detail is still empty, so a value you already keep is never overwritten;
//   - anything else short -> a "Question: answer" line of What we learned (the answers page, lib/questions.js remember), which every
//     later fill's AI reads (worker/src/extension.js answerContext). Why (PR B1, owner 28 Oct 2026 "Retire now, no replay"): the 🧠 Form
//     knowledge notes it wrote before are retired; old ones stay in the store, unread.
// Nothing leaves your store. You can read, fix or delete every line there.
import {asksQuestion} from './label-shape.js';
import {aliasKey} from '../shared/alias-schema.js';
import * as sharedMeanings from './aliases.js';
import * as contactDetails from './contact.js';
import * as questions from './questions.js';
import {splitMark} from '../renderer/question-kind.js';
import {openStore} from './store/index.js';
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

/**
 * Sorts what you typed: a personal fact for an empty detail, or an answer for What we learned.
 * items [{label, value, kind}]; answered: the answers page's lines, lower case ("driving license: b"). -> {details: {street: ...}, answers: [{label, value}]};
 * what is already known is left out.
 */
export function plan(items, {contact = {}, answered = new Set(), aliases = []} = {}) {
  const details = {}, fresh = [];
  for (const item of Array.isArray(items) ? items : []) {
    const label = clean(item?.label), value = clean(item?.value);
    if (label.length < 2 || !value || value.length > 300 || known(label, aliases)) continue;
    const key = personalKey(label, aliases);
    if (key) { if (!contact[key]) details[key] = value; continue; }
    if (answered.has(`${label}: ${value}`.toLowerCase())) continue;
    fresh.push({label, value});
  }
  return {details, answers: fresh};
}

export async function save(storage, payload, {notify = () => {}, contactSaved = () => {}, fetcher} = {}) {
  try {
    const contact = await contactDetails.read(storage, fetcher).catch(() => ({}));
    const page = await openStore(storage, {fetcher}).page('answers').text();
    const answered = new Set(page.split('\n').map(line => splitMark(line.replace(/^[-*]\s+/, '')).text.trim().toLowerCase()));   // a line's kind mark is the form's words (Gitar, #2326)
    const aliases = await sharedMeanings.lookup(storage).catch(() => []);   // the shared label meanings (cached; none with technical reports off)
    const {details, answers} = plan(payload?.items, {contact, answered, aliases});
    if (Object.keys(details).length) { const merged = await contactDetails.save(storage, {...contact, ...details}, fetcher); contactSaved(merged); }
    for (const {label, value} of answers) await questions.remember(storage, label, value, fetcher);
    const count = Object.keys(details).length + answers.length;
    // Decisions, not content: how many, and which kind, never the values (lib/log.js).
    log('learned', `kept ${count} answer(s) you entered yourself: ${Object.keys(details).length} to your details, ${answers.length} to What we learned`,
      {host: String(payload?.host || '').slice(0, 80), details: Object.keys(details)});
    if (count) notify(`Remembered ${count} answer${count === 1 ? '' : 's'}`, `Next forms that ask the same will be filled for you. Read or fix them in Profile → What we learned${notionGate.notionInUse(storage) ? ' and your Notion standard answers' : ''}.`, {view: 'settings', section: 'profile'}, 'good');   // about Notion
    return {ok: true, count};
  } catch (error) {
    log('learned', `could not keep the answers: ${error.message}`);
    return {ok: false, error: error.message};
  }
}

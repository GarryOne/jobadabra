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
import * as learnings from './learnings.js';
import * as verdicts from './question-verdicts.js';
import {factsOf} from './base-facts.js';
import {client as engineClient} from './ai/index.js';
import {splitMark} from '../renderer/question-kind.js';
import {keyOf} from '../renderer/question-filter.js';
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
 * what is already known is left out. An item with remember false (the panel's Remember switched off) is kept nowhere (not in What we learned, not in Your details even for a personal detail): jobOnly [{label, value}].
 */
export function plan(items, {contact = {}, answered = new Set(), aliases = []} = {}) {
  const details = {}, fresh = [], jobOnly = [];
  for (const item of Array.isArray(items) ? items : []) {
    const label = clean(item?.label), value = clean(item?.value);
    if (label.length < 2 || !value || value.length > 300 || known(label, aliases)) continue;
    if (item.remember === false) { jobOnly.push({label, value}); continue; }   // Why (PR C, owner 28 Oct 2026; Gitar on #2351): Remember off = this job only, a personal detail included
    const key = personalKey(label, aliases);
    if (key) { if (!contact[key]) details[key] = value; continue; }
    if (answered.has(`${label}: ${value}`.toLowerCase())) continue;
    fresh.push({label, value});
  }
  return {details, answers: fresh, jobOnly};
}

// client: the AI engine (default the user's, lib/ai/index.js); propose: the meanings pack's proposal channel (lib/server-hooks.js proposalReporter).
export async function save(storage, payload, {notify = () => {}, contactSaved = () => {}, fetcher, client = engineClient(storage), propose = () => {}} = {}) {
  try {
    const contact = await contactDetails.read(storage, fetcher).catch(() => ({}));
    const page = await openStore(storage, {fetcher}).page('answers').text();
    const answered = new Set(page.split('\n').map(line => splitMark(line.replace(/^[-*]\s+/, '')).text.trim().toLowerCase()));   // a line's kind mark is the form's words (Gitar, #2326)
    const aliases = await sharedMeanings.lookup(storage).catch(() => []);   // the shared label meanings (cached; none with technical reports off)
    const {details, answers, jobOnly} = plan(payload?.items, {contact, answered, aliases});
    if (jobOnly.length) verdicts.noteJobOnly(storage, jobOnly.map(each => each.label), {url: String(payload?.job || '')});
    if (Object.keys(details).length) { const merged = await contactDetails.save(storage, {...contact, ...details}, fetcher); contactSaved(merged); }
    // Why (PR B2, owner 28 Oct 2026): what you typed is judged against What we learned like the fill's answers (lib/learnings.js), confirmed: it is yours. An
    // answer the AI did not judge (no AI, a busy one) is kept as before, a line under the form's own words.
    const learnt = answers.length ? await learnings.learn(storage, {answers: answers.map(each => ({...each, state: ''})), client, fetcher, propose,
      owned: (await factsOf(storage, fetcher).catch(() => [])).map(fact => fact.label), job: {}}).catch(() => null) : null;
    if (learnt) verdicts.noteLearned(storage, learnt.evidence, {url: String(payload?.job || '')});   // payload.job: the job's link (extension/tab-identity.js jobOf)
    for (const {label, value} of answers.filter(each => !learnt?.judged.includes(each.label))) await questions.remember(storage, label, value, fetcher);
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

/**
 * The panel's Remember switch before the person decides (PR C, owner 28 Oct 2026: on by default, off when the question names the company). The AI's verdict
 * says it (lib/question-reuse.js: one_job, consent), no company-name match here; a question not judged stays on. -> {label: boolean}.
 */
export async function rememberDefaults(storage, labels, {client = engineClient(storage), company = '', host = ''} = {}) {
  const asked = (Array.isArray(labels) ? labels : []).map(clean).filter(Boolean).slice(0, 40);
  const {verdicts: known} = await verdicts.ensure(storage, asked, {company, host, ai: {client}}).catch(() => ({verdicts: {}}));
  return Object.fromEntries(asked.map(label => [label, !['one_job', 'consent'].includes(known[keyOf(label)]?.reuse)]));
}

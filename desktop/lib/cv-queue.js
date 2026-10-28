// What the CV states or implies but is not sure, as "check it" items of the one review queue (owner, 27 Oct 2026: "Ultimately, the things that are proposed or check it
// or not sure at all, should come in this queue"; "the location of the person, if he worked all the times just on jobs in Moldova and has university in Moldova"; "work
// eligibility status"). Two sources, one item kind ("cvcheck" of lib/details-review.js): the contact proposals the setup read left (lib/contact-from-cv.js, cached per CV
// file) and the base facts of lib/fact-catalog.js (work permit, sponsorship, notice, start, salary, languages), read from the CV by ONE AI call, cached per CV file in
// cv/fact-proposals.json. The AI decides what the CV implies and says how (stated / inferred) and why; the code only validates the shape. Confirm saves the value into
// its home (a Your details section, or 📇 Contact details); an edit replaces it. A value is never saved without that press. Guarded by test/cv-queue.test.js.
import fs from 'node:fs';
import * as contactDetails from './contact.js';
import * as fromCv from './contact-from-cv.js';
import {CATALOG, byId} from './fact-catalog.js';
import {HOME_NAMES, writeHome} from './answer-home.js';
import {hashOf} from './cv-check.js';
import {formatFor} from '../renderer/question-kind.js';
import {splitPermit} from '../renderer/question-values.js';
import {nameOfCode, nationalityOf} from '../renderer/work-eligibility.js';
import {detailsFromCvAtSetup} from './details-at-setup.js';

export const FILE = 'cv/fact-proposals.json';
export const MODEL = fromCv.MODEL;
const SCHEMA = {type: 'object', additionalProperties: false, required: ['facts'], properties: {facts: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['id', 'value', 'how', 'reason'], properties: {id: {type: 'string', enum: CATALOG.map(fact => fact.id)}, value: {type: 'string'}, how: {type: 'string', enum: ['stated', 'inferred']}, reason: {type: 'string'}}}}}};
const INSTRUCTIONS = `You read a CV and say what it states or plainly implies about the applicant's job-application facts listed in <facts> (id: the fact's name; answer: the kind of answer).
Return one entry per fact the CV gives or implies, with value written as a form would take it, how = stated (the CV says it) or inferred (the CV implies it: e.g. the nationality
from the country of birth, schooling and every job; languages from the CV's language lines and the language it is written in), and reason = one short sentence of the evidence.
nationality: the ISO 3166 alpha-2 codes of the countries of citizenship, joined with ", " ("RO, MD"), never a city or a region. A zone (per_country: EU / EEA + Switzerland, United Kingdom,
United States): only when the CV states a permit or visa for it: "yes, with a permit"; never from the nationality, which the app reads itself.
Use only this CV; never guess from a name alone. Leave out a fact the CV neither gives nor implies. Copy values as written; a yes/no fact is "Yes" or "No".`;

// Why (28 Oct 2026, #2322): a nationality is country names and a zone one fixed status, checked here; anything else (a city, "EU citizen") keeps nothing.
const fits = (id, value) => (id === 'nationality' ? Boolean(nationalityOf(value)) : byId(id)?.kind === 'per_country' ? Boolean(splitPermit(value).status) : true);
// Why (28 Oct 2026, #2322 review): the AI names a nationality by ISO code, so "Czech Republic" or "Turkey" is never lost to a spelling; the code writes the name.
const named = (id, value) => (id === 'nationality' ? value.split(/\s*,\s*/).map(part => nameOfCode(part) || part).join(', ') : value);
const clean = (raw, wanted) => {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap(item => {
    const id = String(item?.id || ''), value = named(id, String(item?.value || '').trim().slice(0, 300));
    if (!wanted.includes(id) || !value || seen.has(id) || !fits(id, value)) return [];
    seen.add(id);
    return [{id, value, how: item?.how === 'stated' ? 'stated' : 'inferred', reason: String(item?.reason || '').trim().slice(0, 200)}];
  });
};

// The facts of the catalogue nothing holds yet (labels already in Your details or the Profile, never-asked ones left out). -> [id]
export const wantedFacts = (have, never = []) => CATALOG.filter(fact => !never.includes(fact.id) && !have.some(label => String(label).trim().toLowerCase() === fact.label.toLowerCase())).map(fact => fact.id);

// The kept proposals for this CV, or one call when it was never read for these facts (once per CV file, a failure included). -> [{id, value, how, reason}]
export async function factProposals(storage, {client, wanted, read = fs.readFileSync} = {}) {
  const cv = hashOf(storage);
  if (!cv || !wanted.length) return [];
  let saved = null;
  try { saved = JSON.parse(storage.readText(FILE) || 'null'); } catch {}
  if (saved?.cv === cv) return (saved.proposals || []).filter(item => wanted.includes(item.id));
  if (!client) return [];
  let proposals = [], error = '';
  try {
    const response = await client.messages.create({model: MODEL, max_tokens: 4000, system: INSTRUCTIONS, output_config: {format: {type: 'json_schema', schema: SCHEMA}},
      messages: [{role: 'user', content: [{type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: Buffer.from(read(storage.path('cv.pdf'))).toString('base64')}},
        {type: 'text', text: `<facts>\n${CATALOG.map(fact => `${fact.id}: ${fact.label}; answer: ${fact.kind}`).join('\n')}\n</facts>`}]}]});
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`the read ended: ${response.stop_reason}`);
    proposals = clean(JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').facts, CATALOG.map(fact => fact.id));
  } catch (failure) { error = String(failure?.message || failure).slice(0, 200); }
  storage.writeText(FILE, JSON.stringify({cv, at: new Date().toISOString(), proposals, ...(error ? {error} : {})}));
  return proposals.filter(item => wanted.includes(item.id));
}

const SOURCE = {stated: 'Not sure: check it', inferred: 'Inferred from your CV: check it'};
const item = (ref, fields) => ({key: `details:cvcheck:${JSON.stringify(ref)}`, company: '', hint: '', ...fields,
  details: {kind: 'cvcheck', where: '', ...fields.details}});

// The queue items: contact proposals still unsaved for an empty detail, and the fact proposals. Their question is the queue's generated wording (words.contact from
// lib/contact-review.js wordsFor, words.facts from lib/missing-facts.js wording), never typed; the field's own name when the AI worded nothing. -> [item]
export async function items(storage, {fetcher, client, have = [], never = [], words = {}} = {}) {
  const asked = (map, key, name) => map?.get(key)?.question || name;
  const out = [];
  const contact = await contactDetails.read(storage, fetcher).catch(() => ({}));
  const cv = hashOf(storage);
  if (cv) {
    let saved = null;   // the setup read keys its file by the CV plus the Profile's text (sourceKey): any key that starts with this CV's hash is this CV's
    try { saved = JSON.parse(storage.readText(fromCv.FILE) || 'null'); } catch {}
    for (const each of saved?.cv?.startsWith(cv) ? fromCv.pending(saved, saved.cv, contact) : []) {
      out.push(item({contact: each.field}, {question: asked(words.contact, each.field, contactDetails.LABELS[each.field]), value: each.value, hint: each.source === 'profile' ? 'From your Profile' : '',
        format: formatFor({marked: {kind: 'text'}}), details: {source: SOURCE[each.inferred ? 'inferred' : 'stated'], where: 'Your details → Contact details', fact: contactDetails.LABELS[each.field], inferred: !!each.inferred}}));
    }
  }
  for (const each of await factProposals(storage, {client, wanted: wantedFacts(have, never)}).catch(() => [])) {
    const fact = byId(each.id);
    out.push(item({fact: each.id}, {question: asked(words.facts, each.id, fact.label), value: each.value, hint: each.reason, format: formatFor({marked: {kind: fact.kind}}),
      details: {source: SOURCE[each.how], where: HOME_NAMES[fact.home], fact: fact.label, inferred: each.how === 'inferred'}}));
  }
  return out;
}

// Confirm (the proposed value) or an edit (the new one). -> {ok, homeName, error}
export async function answer(storage, ref, value, {fetcher, save} = {}) {
  const text = String(value ?? '').trim();
  if (!text) return {ok: false, error: 'Type the answer'};
  if (ref.contact) {
    if (!contactDetails.LABELS[ref.contact]) return {ok: false, error: 'That question is no longer open'};
    const contact = await contactDetails.read(storage, fetcher);
    await contactDetails.save(storage, {...contact, [ref.contact]: text}, fetcher);
    return (await contactDetails.read(storage, fetcher))[ref.contact] === text ? {ok: true, homeName: 'Your details → Contact details'} : {ok: false, error: 'It did not save; nothing else changed'};
  }
  const fact = byId(ref.fact);
  if (!fact) return {ok: false, error: 'That question is no longer open'};
  return await writeHome(storage, fact.home, fact.label, text, fetcher, save, fact.kind) ? {ok: true, homeName: HOME_NAMES[fact.home]} : {ok: false, error: 'It did not save; nothing else changed'};
}

// An install whose CV was never read for its details (it was set up before the wizard step): the same read the setup runs, once per CV file, when the queue opens
// and a contact detail is empty. Sure values are saved, the rest becomes items above. -> true when it ran.
export async function readOnce(storage, {client, log = () => {}, contactSaved = () => {}} = {}) {
  const cv = hashOf(storage);
  if (!client || !cv || storage.settings().cvQueueRead === cv) return false;
  storage.saveSettings({cvQueueRead: cv});   // before the call: a failed read is not repeated on every list
  const contact = await contactDetails.read(storage).catch(() => ({}));
  if (!fromCv.emptyFields(contact).length) return false;
  await detailsFromCvAtSetup(storage, {client, log, contactSaved});
  return true;
}

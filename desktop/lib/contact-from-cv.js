// "Your details from your CV": Claude reads the CV once per CV file and proposes a value for each empty contact field it states
// (phone, street, postal code, town, date of birth, place of origin, salutation…). Nothing is saved here: the proposals fill the
// empty boxes of Settings → Profile → Your details, marked "from your CV", and Save there is the confirmation (owner, 8 Oct 2026:
// a Coop form stopped on 9 questions whose answers were half in the CV). A field you filled is never proposed over.
// The Profile's text goes beside the CV (9 Oct 2026: Coop's "Localité" stayed empty with no proposal; the town was in the Profile, not the CV):
// a value only the Profile states is marked source "profile" and always "check it". Asked again when the CV or the Profile changes.
// Guarded by test/contact-from-cv.test.js.
import {nameOfClient} from './ai/names.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {LABELS} from './contact.js';
import {inFlight} from './in-flight.js';

export const MODEL = 'claude-haiku-5-5';
export const FILE = 'cv/contact-proposals.json';
const NEVER = new Set(['full_name']);   // made from first + last name on Save
export const FIELDS = Object.keys(LABELS).filter(key => !NEVER.has(key));

const INSTRUCTIONS = `You read a CV, and the applicant's own profile text when given in <profile>, and copy the applicant's own contact details out of them,
Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.
to prefill a form they will check. Return one proposal per requested field that the CV or the profile states; source says which one stated it. Copy values as written (phone with its country code if the CV has one).
location is the town or city they live in; street is street and number only; postal_code is the postal code only.
salutation is how forms address them (e.g. "Mr", "Ms", or the CV's own language: "Monsieur", "Madame", "Herr", "Frau"): propose it only when the CV
shows it (a title, a gendered word such as "né"/"née" or "geboren als"), with sure=false. Never invent a value, never guess from a name alone.
first_name and last_name are the applicant's own name as the CV's heading or contact block writes it: copy it even when it is the same as the name of an account you are signed in with.
A value the CV does not write but plainly implies may be inferred, with how=inferred and sure=false: e.g. location when every job and the education of recent years are in one city or
country (the most recent city; the country alone when only the country is clear). Never infer a phone, an e-mail, a link, a street, a postal code or a date of birth.
Leave out a field neither gives nor implies. how=stated and sure=true only when the CV states the value plainly.`;

const SCHEMA = {type: 'object', additionalProperties: false, required: ['proposals'], properties: {proposals: {type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['field', 'value', 'sure', 'source', 'how'],
  properties: {field: {type: 'string', enum: FIELDS}, value: {type: 'string'}, sure: {type: 'boolean'}, source: {type: 'string', enum: ['cv', 'profile']}, how: {type: 'string', enum: ['stated', 'inferred']}}}}}};

// The fields worth asking about: known, and empty in what you saved.
export const emptyFields = (contact = {}) => FIELDS.filter(key => !String(contact?.[key] || '').trim());

// Claude's answer, kept to the requested fields, one per field, short and trimmed. → [{field, value, sure}]
export function cleanProposals(raw, wanted) {
  const allowed = new Set(wanted), seen = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap(item => {
    const field = String(item?.field || ''), value = String(item?.value || '').trim().slice(0, 200);
    if (!allowed.has(field) || !value || seen.has(field)) return [];
    seen.add(field);
    const profile = item?.source === 'profile';   // only the Profile states it: a suggestion to check, never "From your CV"
    const inferred = item?.how === 'inferred' && !['phone', 'email', 'linkedin', 'github', 'website', 'street', 'postal_code', 'birth_date'].includes(field);   // a contact channel is never inferred
    if (item?.how === 'inferred' && !inferred) return [];
    return [{field, value, sure: field === 'salutation' || profile || inferred ? false : item?.sure === true, ...(profile ? {source: 'profile'} : {}), ...(inferred ? {inferred: true} : {})}];
  });
}

// The proposals kept for this CV, still for empty fields only (a field you filled since drops out). → [] when none or another CV.
export function pending(saved, cvHash, contact) {
  if (!saved || !cvHash || saved.cv !== cvHash) return [];
  const empty = new Set(emptyFields(contact));
  return (saved.proposals || []).filter(item => empty.has(item.field));
}

// The CV's sure values for the details you left empty, for a form only (owner, 27 Oct 2026: "Empty saved detail → the fill types the CV's sure value and
// marks it 'from your CV: check it'; the Profile is not changed"). A Greenhouse form stayed without First/Last Name while the CV read had proposed both and
// nobody pressed Save. Only proposals of THIS CV file (the key's part before "+": a later Profile edit does not change what the CV states), sure, stated by the CV
// (a Profile-only value is never sure). Nothing is written. -> {details: {key: value}, keys: [key]}
export function cvFallback(saved, cvFile, contact = {}) {
  const fromFile = String(saved?.cv || '').split('+')[0];
  if (!cvFile || fromFile !== cvFile) return {details: {}, keys: []};
  const empty = new Set(emptyFields(contact));
  const details = {};
  for (const item of saved?.proposals || []) {
    if (item?.sure === true && item.source !== 'profile' && empty.has(item.field) && !details[item.field] && String(item.value || '').trim()) details[item.field] = String(item.value).trim();
  }
  return {details, keys: Object.keys(details)};
}
export function cvFallbackFor(storage, cvFile, contact) {
  let saved = null;
  try { saved = JSON.parse(storage.readText(FILE) || 'null'); } catch {}
  return cvFallback(saved, cvFile, contact);
}

// One Claude call on the CV PDF. → {proposals, usd?} ; throws on an AI failure (the caller says why).
export async function propose(client, cvPdf, wanted, profile = '') {
  if (!wanted.length) return {proposals: []};
  const response = await client.messages.create({
    model: MODEL, max_tokens: 8000, system: INSTRUCTIONS,   // room for thinking (an answer cut short is not JSON)
    messages: [{role: 'user', content: [
      {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: Buffer.from(cvPdf).toString('base64')}},
      ...(String(profile || '').trim() ? [{type: 'text', text: `<profile>\n${String(profile).slice(0, 20000)}\n</profile>`}] : []),
      {type: 'text', text: `Fields to fill: ${wanted.map(key => `${key} (${LABELS[key]})`).join(', ')}`}]}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}},
  });
  if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(client)} declined to read the CV`);
  if (response.stop_reason === 'max_tokens') throw new Error(`${nameOfClient(client)}'s answer was cut short`);
  const text = response.content?.find(block => block.type === 'text')?.text || '{}';
  return {proposals: cleanProposals(JSON.parse(text).proposals, wanted)};
}

// The proposals for the CV there is now: kept ones, or one call when this CV was never read for them (once per CV file, a failure
// included, so opening Profile never pays twice; `again` asks anew). → {proposals, cv, fresh, error?}
const once = inFlight();
export function forCv(storage, options = {}) {   // the same CV asked twice at once (the session page and Profile at start): one call
  return options.again || !options.cvHash ? forCvNow(storage, options) : once(options.cvHash, () => forCvNow(storage, options));
}
// What the applicant has stated, beside the CV: the Profile, the standard Answers and the Knowledge page (learned notes), each under its name, the
// same texts the form AI reads (worker/src/extension.js). 9 Oct 2026, the twin: Coop's town was stated only in Knowledge, so the form AI proposed it
// once and this call never could.
export const statedText = ({profile = '', answers = '', knowledge = ''} = {}) => [['Profile', profile], ['Standard answers', answers], ['Learned notes', knowledge]]
  .filter(([, text]) => String(text || '').trim()).map(([name, text]) => `## ${name}\n${String(text).trim()}`).join('\n\n');
// What the proposals were made from: the CV file, and the Profile's text when there is one (a change to either asks again).
export const sourceKey = (cvHash, profile = '') => (cvHash && String(profile || '').trim()
  ? `${cvHash}+${crypto.createHash('sha256').update(String(profile)).digest('hex').slice(0, 12)}` : cvHash || '');
async function forCvNow(storage, {contact, client, cvHash: cvFile, profile = '', again = false, log = () => {}, read = fs.readFileSync} = {}) {
  const cvHash = sourceKey(cvFile, profile);
  let saved = null;
  try { saved = JSON.parse(storage.readText(FILE) || 'null'); } catch {}
  if (!cvHash) return {proposals: [], cv: ''};
  if (saved?.cv === cvHash && !again) return {proposals: pending(saved, cvHash, contact), cv: cvHash, fresh: false, error: saved.error || ''};
  if (!client) return {proposals: [], cv: cvHash, fresh: false, error: 'no AI'};
  const wanted = emptyFields(contact), started = Date.now();
  let proposals = [], error = '';
  try { ({proposals} = await propose(client, read(storage.path('cv.pdf')), wanted, profile)); } catch (failure) { error = String(failure?.message || failure).slice(0, 200); }
  storage.writeText(FILE, JSON.stringify({cv: cvHash, at: new Date().toISOString(), proposals, ...(error ? {error} : {})}));
  // Which fields, never their values (lib/log.js): enough to tell "nothing in the CV" from "Claude failed".
  log('profile', error ? `details from the CV: failed: ${error}` : `details from the CV: ${proposals.length} of ${wanted.length} proposed`,
    {cv: cvHash, asked: wanted, proposed: proposals.map(item => item.field), fromProfile: proposals.filter(item => item.source === 'profile').map(item => item.field), ms: Date.now() - started});
  return {proposals: pending({cv: cvHash, proposals}, cvHash, contact), cv: cvHash, fresh: true, error};
}

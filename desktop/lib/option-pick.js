// The form's own choice for an answer ("Monsieur" in a Madam/Sir menu → "Sir"), for a session page row whose field is a menu. The same
// text (any case) is taken at once; otherwise Claude picks the choice that means the same, from the choices only, or none, and the
// answer is kept per answer and set of choices (option-picks.json). Owner, 8 Oct 2026: a CV's French salutation was typed into an
// English menu. Claude sees the field's label, the answer and the choices. Guarded by test/option-pick.test.js.
export const MODEL = 'claude-haiku-5-5';
import {forget, keep, keptValue, readKept} from './kept-decisions.js';
export const FILE = 'option-picks.json';
const norm = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Why (27 Oct 2026, fair round form 264401 'Level of Spanish'; owner: close the gap to Browser Use): the menu was a 4-level scale in Spanish, the applicant a native speaker; "means the same" has no
// choice for a value ON a scale, so the answer flipped between draws ("Native" 2/3, "Nativo" 0/3) and the field stayed empty. Case set: test/option-pick-cases.json.
const INSTRUCTIONS = `A job application form asks a question with fixed choices. Given the applicant's answer, return the choice that means the same
(the same answer in another language or wording, e.g. "Monsieur" means "Sir" or "Mr"), copied exactly, or "" when no choice means the same.
An answer to a yes/no question means the choice that states it ("Yes" to "do you have the right to work here?" means the choice saying you have it).
Never pick a choice that changes the meaning.
A choice that only says nothing is chosen yet (a placeholder such as "No Selection", "Select...", "Please choose", often the first one) means the same as no answer: never return it, return "" instead.
When the choices are an ordered scale (levels of a skill, ranges of years or size, ratings) and the answer is a value on that scale in any wording or language ("native", "fluent", "B1", "4 years"),
return the choice whose level or range holds it, reading each choice's own description; a value above the top level is the top choice. Only for an answer that is a value on that scale: an answer that is not one returns "".`;

// A search box (the page says so: searchable) may show only the start of its list, or what an earlier search found (owner, 27 Oct 2026, fair round form 102: Greenhouse's
// School list opens on its first 100 schools; "search, then Other"): the AI may also name what to type to find the choice, in order: the answer's own name, then the list's
// own choice for answers it does not list. That choice is returned only once the answer itself was searched for (tried) and not found.
const SEARCH_INSTRUCTIONS = `This menu is a search box: the choices shown may be only the start of its list, or what an earlier search found ("tried" lists what was already typed).
When no choice shown means the same, return in "searches" what to type to find one that does, in order, at most 3: the answer's own name (its distinctive words), then the
word for the list's own choice for answers it does not list (such as "Other"); never anything already tried. Return no searches when the choices shown are clearly the whole list.
Only when "tried" already holds the answer's own name and no choice means the same: a choice that is the list's own catch-all for answers it does not list (such as "Other" or
"Not listed") is the right choice; return it.`;
export const CONSENT_INSTRUCTIONS = `The saved setting authorizes only agreeing to application terms, a privacy policy or data-processing notice. Read the question AND every actual option in any language. Return agreement true and the exact affirmative agreement option only when this is unambiguously that consent. Never choose a refusal, placeholder, marketing preference, eligibility/sponsorship/qualification answer, certification, signature or factual attestation (including a combined consent and attestation). Ambiguous, unread or no affirmative option: agreement false and choice "". One option alone is no evidence of agreement.`;
const keyOf = (value, choices, label = '') => `${norm(label)}|${norm(value)}|${choices.map(norm).sort().join('|')}`;
// The page contradicted the kept answer (the banner is still there after its button was pressed): dropped, asked again next time.
export const forgetOption = (storage, {label = '', value = '', options = []}) => forget(storage, FILE, keyOf(value, (options || []).map(String).filter(option => option.trim()), label));
// → {choice, how: 'same' | 'ai' | 'kept' | 'none'}; choice '' when none fits (or no AI to ask).
// searchable, tried: a search box and what was already typed in it (above); then the answer may carry `searches`, never kept (the list a search shows changes).
export async function pickOption(storage, {label = '', value, options, searchable = false, tried = [], consent = false}, {client, log = () => {}} = {}) {
  const choices = (options || []).map(String).filter(option => option.trim());
  const same = !consent && choices.find(option => norm(option) === norm(value));
  if (same || (!choices.length && !searchable) || !String(value || '').trim()) return {choice: same || '', how: same ? 'same' : 'none'};
  const kept = readKept(storage, FILE), key = keyOf(value, choices, label);
  const known = searchable || consent ? {found: false} : keptValue(kept, key);   // young answers only; a contradicted one was forgotten (lib/kept-decisions.js)
  if (known.found) return {choice: choices.includes(known.value) ? known.value : '', how: 'kept'};
  const typed = (tried || []).map(String).filter(Boolean).slice(0, 3);
  if (!client) return {choice: '', how: 'none'};
  const started = Date.now();
  try {
    const response = await client.messages.create({model: MODEL, max_tokens: 8000, system: consent ? CONSENT_INSTRUCTIONS : searchable ? `${INSTRUCTIONS}\n${SEARCH_INSTRUCTIONS}` : INSTRUCTIONS,
      messages: [{role: 'user', content: JSON.stringify({question: String(label).slice(0, 200), answer: String(value).slice(0, 200), choices, ...(searchable ? {tried: typed} : {})})}],
      output_config: {format: {type: 'json_schema', schema: {type: 'object', additionalProperties: false, required: consent ? ['choice', 'agreement'] : searchable ? ['choice', 'searches'] : ['choice'],
        properties: {choice: {type: 'string', enum: [...choices, '']}, ...(consent ? {agreement: {type: 'boolean'}} : {}), ...(searchable ? {searches: {type: 'array', items: {type: 'string'}}} : {})}}}}});
    if (response.stop_reason === 'refusal') throw new Error('AI refused the choice');
    if (response.stop_reason === 'max_tokens') throw new Error('answer cut short');
    const said = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}');
    const picked = (!consent || said.agreement === true) && choices.includes(said.choice) ? said.choice : '';
    // What to type next: short texts, none already typed, at most 3 (validated here: the page types them for real).
    const searches = searchable && !picked ? [...new Set((Array.isArray(said.searches) ? said.searches : []).map(text => String(text).replace(/\s+/g, ' ').trim()).filter(text => text && text.length <= 60 && !typed.some(done => norm(done) === norm(text))))].slice(0, 3) : [];
    if (!searchable && !consent) keep(storage, FILE, kept, key, picked);
    log('fill', picked ? 'a menu choice picked by meaning' : searches.length ? 'a menu choice to search for' : 'no menu choice means the same', {choices: choices.length, ...(searchable ? {searches: searches.length, tried: typed.length} : {}), ms: Date.now() - started});
    return {choice: picked, how: 'ai', ...(searchable ? {searches} : {})};
  } catch (error) {
    log('fill', `menu choice not picked: ${String(error?.message || error).slice(0, 160)}`, {choices: choices.length});
    return {choice: '', how: 'none'};
  }
}

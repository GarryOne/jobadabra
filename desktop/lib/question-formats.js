// What kind of answer each question takes, kept on this Mac (settings.questionFormats, keyed like the verdicts): specific fill controls and their options are structural;
// generic text controls need one AI judgment from the label to distinguish dates, durations and prose (owner, 17 Oct 2026: "Title", "Country/Region of Residence"
// were text boxes). The store's mark on the line wins over both (renderer/question-kind.js formatFor). Rebuildable form structure,
// never the person's answers. Spec docs/superpowers/specs/2026-10-17-base-facts.md. Guarded by test/question-formats.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import {AI_KINDS, KINDS_VERSION, cleanOptions, formatOfField} from '../renderer/question-kind.js';
import {keyOf, looksLikeFieldId} from '../renderer/question-filter.js';

export const MODEL = 'claude-haiku-5-5';
export const LISTS = ['', 'countries'];
const MAX = 600;
export const RECHECK_MAX = 10;   // old judgments asked again per call, never a mass run
export const kept = storage => storage.settings().questionFormats || {};

function save(storage, next) {
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX))) delete next[key];
  storage.saveSettings({questionFormats: next});
}

// A fill's trace rows ({label, type, options, multiple}) -> each labelled field's format, kept (a fill's reading replaces an AI guess and an older fill's).
export function noteFields(storage, rows = []) {
  const next = {...kept(storage)};
  let changed = false;
  for (const row of rows) {
    const label = String(row?.label || '').replace(/^[\s*]+|[\s*]+$/g, '');
    if (!label || looksLikeFieldId(label) || !row.type || row.type === 'file' || row.type === 'password') continue;
    const format = formatOfField(row);
    const before = next[keyOf(label)];
    // Why (#2312): a generic text box says nothing about meaning; a current AI judgment of the label stays (judged once, not per fill).
    if (format.kind === 'text' && before?.from === 'ai' && (before.kinds || 0) >= KINDS_VERSION) continue;
    // A menu read while closed has no options: an older reading's options for the same kind stay.
    const options = format.options.length ? format.options : before?.kind === format.kind ? before.options || [] : [];
    // Whether a date question also asks about constraints is the label's meaning (the AI's judgment), not the field's: it stays.
    const constraints = format.kind === 'date' && before?.constraints !== undefined ? {constraints: before.constraints} : {};
    next[keyOf(label)] = {kind: format.kind, options, ...constraints, from: 'fill', at: new Date().toISOString().slice(0, 10)};
    changed = true;
  }
  if (changed) save(storage, next);
}

// allow: kinds a caller may offer beyond AI_KINDS (Your details' sections: per country in Work eligibility, language in Languages).
const schemaFor = (allow = []) => ({type: 'object', additionalProperties: false, required: ['formats'], properties: {formats: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['label', 'kind', 'constraints', 'options', 'list'], properties: {label: {type: 'string'}, kind: {type: 'string', enum: [...AI_KINDS, ...allow]}, constraints: {type: 'boolean'}, list: {type: 'string', enum: LISTS},
    options: {type: 'array', items: {type: 'string'}}}}}}});
const EXTRA = {per_country: '- "per_country": whether the person may work in a country (allowed, or needs a visa), with the permit.', language: '- "language": how well the person speaks a language (a level such as B2 or native).'};
const INSTRUCTIONS = `A job-application form asked these questions; we no longer have the form, only each question's words, in any language. For each, say how such a question is answered on a form:
- "text": a short typed answer (a name, a date, a number, a city, a link).
- "long_text": a written paragraph (a motivation, a description).
- "single": one choice from a list (a salutation or title, a country, a level, Yes or No with more choices).
- "multi": several choices from a list.
- "yes_no": a single box ticked or not, or a plain Yes / No.
- "date": one specific calendar day the person can enter in a date picker (a date of birth, a start date, a date on which something happened). Do not use for a length of time ("notice period", "how many years of experience"), a year without month/day, or availability stated as prose ("immediately", "in 2 months", "flexible"). An availability question asking for one exact day is a date.
- "amount": a sum of money with a currency (a fee, a budget).
- "salary": pay per period: an amount with a currency and a period such as per year or per month (a salary expectation, a rate).
- "duration": a length of time (a notice period, how long until available).
- "link": a web address (a LinkedIn, GitHub or portfolio link).
constraints: true only for a "date" question that also asks about constraints, conditions or limits on that date (e.g. "earliest start date, and are there any constraints we should be aware of?"), else false.
options: for "single" or "multi", the usual choices of such a question when they are few and standard (at most 8, in the question's language), else [].
list: "countries" when the choice is a country (then options []), else "".
Answer every label exactly as given. Use "date" only when the answer is one exact calendar day; use "duration" for elapsed time, "text" for a year-only answer or availability prose, and "text" when unsure. Never let the word "date" alone decide the kind.`;

// The labels with no kept format yet -> one small call; kept with from: 'ai'. ai: {client, apiKey} (none: nothing new). -> {formats: the whole map, usage}.
export async function ensure(storage, labels, {ai = {}, allow = []} = {}) {
  const known = kept(storage);
  // A date the fill saw has no constraints judgment yet: asked once (the AI never changes what the fill saw).
  const needs = label => !known[keyOf(label)] || (known[keyOf(label)].from === 'fill' && (known[keyOf(label)].kind === 'text' || (known[keyOf(label)].kind === 'date' && known[keyOf(label)].constraints === undefined)));
  // An AI judgment made before the current kinds existed (stamped lower, or not at all) is asked again, once; a kind read from a form's own field is never.
  const stale = label => known[keyOf(label)]?.from === 'ai' && (known[keyOf(label)].kinds || 0) < KINDS_VERSION;
  const asked = [...new Set(labels.filter(label => label && !looksLikeFieldId(label)))];
  const fresh = [...asked.filter(needs).slice(0, 80), ...asked.filter(label => !needs(label) && stale(label)).slice(0, RECHECK_MAX)];
  const client = ai.client || (ai.apiKey ? anthropicApi(ai.apiKey) : null);
  if (!fresh.length || !client) return {formats: known, usage: null};
  const response = await client.messages.create({model: MODEL, max_tokens: 4000, system: [INSTRUCTIONS, ...allow.map(kind => EXTRA[kind]).filter(Boolean)].join('\n'),
    messages: [{role: 'user', content: `<questions>\n${JSON.stringify(fresh)}\n</questions>`}],
    output_config: {format: {type: 'json_schema', schema: schemaFor(allow)}, effort: 'low'}});
  const next = {...kept(storage)}, at = new Date().toISOString().slice(0, 10);
  // A label the AI left out or answered wrongly is kept as text: judged once, never asked again (a fill's reading replaces it).
  const seen = new Set(fresh.filter(label => !known[keyOf(label)] || (known[keyOf(label)].from === 'fill' && known[keyOf(label)].kind === 'text')));
  for (const label of seen) next[keyOf(label)] = {kind: 'text', options: [], list: '', constraints: false, from: 'ai', at, kinds: KINDS_VERSION};
  for (const label of fresh) if (stale(label)) next[keyOf(label)] = {...known[keyOf(label)], kinds: KINDS_VERSION};   // asked again: the AI's answer below replaces the kind, a silent one keeps it
  for (const each of judged(response, fresh, allow)) {
    const before = known[keyOf(each.label)];
    if (before && stale(each.label)) next[keyOf(each.label)] = {kind: each.kind, options: each.options, list: each.list, constraints: each.constraints, from: 'ai', at, kinds: KINDS_VERSION};
    else if (before && !(before.from === 'fill' && before.kind === 'text')) next[keyOf(each.label)] = {...before, constraints: each.constraints};
    else next[keyOf(each.label)] = {kind: each.kind, options: each.options, list: each.list, constraints: each.constraints, from: 'ai', at, kinds: KINDS_VERSION};
  }
  // A fill-read date the AI left unanswered is judged "no constraints": asked once, never again.
  for (const label of fresh) if (known[keyOf(label)] && next[keyOf(label)].constraints === undefined) next[keyOf(label)] = {...next[keyOf(label)], constraints: false};
  save(storage, next);
  return {formats: next, usage: response.usage || null};
}

// The AI's answer, validated: a label we did not ask, an unknown kind or list is dropped; options only for a choice, at most 8.
export function judged(response, asked, allow = []) {
  let parsed = {};
  try { parsed = JSON.parse(response?.content?.find(block => block.type === 'text')?.text || '{}'); } catch { return []; }
  const out = [];
  for (const each of Array.isArray(parsed.formats) ? parsed.formats : []) {
    if (!asked.includes(each?.label) || ![...AI_KINDS, ...allow].includes(each.kind)) continue;
    const choice = each.kind === 'single' || each.kind === 'multi';
    const list = choice && LISTS.includes(each.list) ? each.list : '';
    out.push({label: each.label, kind: each.kind, list, constraints: each.constraints === true, options: choice && !list ? cleanOptions(each.options).slice(0, 8) : []});
  }
  return out;
}

// One question's kept format (or null).
export const keptFor = (storage, question) => kept(storage)[keyOf(question)] || null;

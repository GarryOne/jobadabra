// The facts of Your details that forms ask most and the person has not given, as items of the Fill your details drawer (owner, 28 Oct 2026; 18 Oct 2026: "on a fresh install, a queue
// of the most important things not filled; step by step, don't overwhelm; be proactive"). The kind "missing" of lib/details-review.js. Most important first =
// the queue's own score (renderer/question-filter.js factScore: form questions that mean this fact, blocked a fill first, then how many forms asked), then the share of installs whose forms asked it (the alias pack, lib/fact-asks.js), else the catalogue's
// order. Paced: at most PER_DAY new facts a day (a fact that blocked a fill is asked at once, beyond the cap), never again after "Don't keep", and only for
// FRESH_DAYS after the first ask, then only the facts a fill is blocked on. Guarded by test/missing-facts.test.js.
import {formatFor} from '../renderer/question-kind.js';
import {anthropicApi} from './ai/anthropic-api.js';
import {MODEL} from './question-reuse.js';
import {BLOCKED, factScore} from '../renderer/question-filter.js';
import {CATALOG, byId} from './fact-catalog.js';
import {written} from './queue-wording.js';
import {NATIONALITY} from '../renderer/work-eligibility.js';

export {CATALOG, byId};

export const PER_DAY = 3;
export const FRESH_DAYS = 14;

const plain = text => String(text || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const day = date => date.toISOString().slice(0, 10);
const state = storage => ({never: [], seen: {}, today: [], ...(storage.settings().missingFacts || {})});

// Which facts the saved lines already answer, whatever their wording or language ("Citizenship: Romanian" answers "Nationality"): the AI's one fixed answer,
// kept per set of labels (settings.missingFacts.covered), so a Profile is read once, not on every list. No AI: only a line with the fact's own label counts.
const SCHEMA = {type: 'object', additionalProperties: false, required: ['covered'], properties: {covered: {type: 'array', items: {type: 'string'}}}};
const INSTRUCTIONS = 'Facts a job application asks about are listed in <facts> (id: label). <lines> are the labels of what the applicant already saved. Answer covered: the ids of the facts that one of the saved lines already answers, in any language or wording (a line "Citizenship" answers "Nationality"; "Languages I can work in" answers "Languages"). A fact no line answers is not listed.';
export async function covered(storage, labels, {ai = {}} = {}) {
  const held = new Set(labels.map(plain)), open = CATALOG.filter(fact => !held.has(plain(fact.label)));
  const lines = [...new Set(labels.map(label => String(label).trim()).filter(Boolean))].sort(), sig = [...open.map(fact => fact.id), '|', ...lines].join('~');
  const kept = state(storage).covered;
  if (kept?.sig === sig) return kept.ids;
  const client = ai.client || (ai.apiKey ? anthropicApi(ai.apiKey) : null);
  if (!open.length || !lines.length || !client) return [];
  try {
    const response = await client.messages.create({model: MODEL, max_tokens: 300, system: INSTRUCTIONS, output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'},
      messages: [{role: 'user', content: `<facts>\n${open.map(fact => `${fact.id}: ${fact.label}`).join('\n')}\n</facts>\n<lines>\n${JSON.stringify(lines).slice(0, 6000)}\n</lines>`}]});
    const ids = (JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').covered || []).filter(id => open.some(fact => fact.id === id));   // an id the AI invented keeps nothing
    storage.saveSettings({missingFacts: {...(storage.settings().missingFacts || {}), covered: {sig, ids}}});
    return ids;
  } catch { return []; }   // tried again at the next list
}

// Each fact's question and hint, worded by the queue's one question writer (lib/queue-wording.js, as the contact questions; owner, 27 Oct 2026: "Yes, write them too"),
// once per catalogue and language (settings.factWording). The kind shapes the question (a yes/no one, a date, a period...). -> Map id -> {question, hint}; empty with no AI
// (a fact is then asked by its own name).
const WORDING = `Facts a job application asks an applicant are listed in <facts> (id: the fact's name; answer: the kind of answer). For each fact write the short question to ask
the applicant (their language; <language> when given, else English) and a hint of a few words saying what to give. The kind shapes the question: yes_no = a yes/no question,
date = a day, duration = a length of time, salary = an amount and currency, language = the languages and the level in each, text = a few words.`;
export async function wording(storage, {client, language = ''} = {}) {
  const sig = [...CATALOG.map(fact => `${fact.id}:${fact.kind}:${fact.label}`), language].join('~');
  const list = await written(storage, {cache: 'factWording', sig, system: WORDING, tag: 'facts', client, maxTokens: 1000,
    fields: CATALOG.map(fact => ({key: fact.id, label: `${fact.label}; answer: ${fact.kind}`})), extra: language ? `\n<language>${language}</language>` : ''});
  return new Map((list || []).map(each => [each.field, {question: each.question, hint: each.hint}]));
}

// The facts nothing holds yet, as {label, value: ''} for lib/base-facts.js: the question AI maps a form question to one, and that question is then asked once, as
// this item (owner, 18 Oct 2026: "Ask once"). Not the ones the AI found answered or the person never wants asked.
export function listed(storage, known = []) {
  const mine = state(storage), answered = mine.covered?.ids || [];
  return CATALOG.filter(fact => !answered.includes(fact.id) && !mine.never.includes(fact.id) && !known.some(label => plain(label) === plain(fact.label))).map(fact => ({label: fact.label, value: ''}));
}

// have: the labels Your details and the Profile already hold (answered or asked); covered: the ids the AI says they answer (covered() above); words: wording() above.
// -> the items to show now: [{key id, question, format, hint, score, home, fact}].
// Writes the day's pick once (settings.missingFacts), so the same facts stay in the queue all day.
export function pick(storage, have, {now = new Date(), covered: known = [], shares = {}, words = new Map()} = {}) {
  const held = new Set([...have].map(plain)), mine = state(storage), today = day(now), verdicts = storage.settings().questionVerdicts || {};
  const since = mine.since || today, fresh = (now - new Date(`${since}T00:00:00Z`)) / 864e5 < FRESH_DAYS;
  // Why (28 Oct 2026, owner, #2322: "ask as less as possible"): a zone waits for Nationality, which may answer it (have then holds the zones it opens).
  const waits = fact => fact.kind === 'per_country' && !held.has(plain(NATIONALITY)) && !mine.never.includes('nationality');
  const open = CATALOG.filter(fact => !held.has(plain(fact.label)) && !known.includes(fact.id) && !mine.never.includes(fact.id) && !waits(fact)).map((fact, order) => ({fact, order, score: factScore(fact.label, verdicts)}));
  const blocked = open.filter(each => each.score >= BLOCKED);
  const rank = (a, b) => b.score - a.score || (shares[b.fact.id] || 0) - (shares[a.fact.id] || 0) || (mine.seen[a.fact.id] || '').localeCompare(mine.seen[b.fact.id] || '') || a.order - b.order;
  let chosen;
  if (mine.day === today) chosen = open.filter(each => mine.today.includes(each.fact.id) || each.score >= BLOCKED);
  else {
    const rest = open.filter(each => each.score < BLOCKED).sort(rank).slice(0, fresh ? PER_DAY : 0);
    chosen = [...blocked, ...rest];
    storage.saveSettings({missingFacts: {...mine, since, day: today, today: chosen.map(each => each.fact.id), seen: {...mine.seen, ...Object.fromEntries(chosen.map(each => [each.fact.id, today]))}}});
  }
  return chosen.sort(rank).map(({fact, score}) => ({id: fact.id, home: fact.home, label: fact.label, question: words.get(fact.id)?.question || fact.label, hint: words.get(fact.id)?.hint || '', score, format: formatFor({marked: {kind: fact.kind}})}));
}

// "Don't keep": the fact is never asked again.
export function never(storage, id) {
  const mine = state(storage);
  if (!mine.never.includes(id)) storage.saveSettings({missingFacts: {...(storage.settings().missingFacts || {}), never: [...mine.never, id]}});
}

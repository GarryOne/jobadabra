// What the AI judges about the questions a form asked: reusable across jobs or one job's, and whether the applicant's standard answers already cover it
// (owner, 17 Oct 2026: "text-3219", "Colonist Profile", one-off essays and "earliest start date" filled Needs review / Answer once). The fixed answer is
// validated here: an unknown label, an unclear verdict or a covered_by that is not one of the given answers keeps nothing. Guarded by test/question-reuse.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import {keyOf, looksLikeFieldId} from '../renderer/question-filter.js';
import {splitPermit} from '../renderer/question-values.js';
import {NATIONALITY, ZONES, eligibilityOf, rowFor, settles} from '../renderer/work-eligibility.js';

export {looksLikeFieldId};
export const MODEL = 'claude-haiku-5-5';
// A topic as kept: a few lowercase words (the same question on two forms, in any wording, gets the same ones: "seen twice", lib/question-verdicts.js).
export const topicOf = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').slice(0, 5).join(' ');
export const VERDICTS = ['reusable', 'one_job', 'consent'];
export const ASKS = ['work_right', 'sponsorship'];
// A label that means a fact of Your details is answered from there and never asked (owner, 17 Oct 2026): its verdict is "details", with the fact's label.
export const DETAILS = 'details';
const CHUNK = 25;   // labels per call: 25 verdicts (~45 tokens each) fit max_tokens 2000 with room

const SCHEMA = {type: 'object', additionalProperties: false, required: ['verdicts'], properties: {verdicts: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['label', 'verdict', 'covered_by', 'value', 'topic', 'fact', 'asks', 'country', 'sensitive'], properties: {label: {type: 'string'}, verdict: {type: 'string', enum: VERDICTS}, covered_by: {type: 'string'}, value: {type: 'string'},
  topic: {type: 'string'}, fact: {type: 'string'}, asks: {type: 'string', enum: ['', ...ASKS]}, country: {type: 'string'}, sensitive: {type: 'boolean'}}}}}};
const INSTRUCTIONS = `A job-application form asked these questions. For each decide its verdict:
- "reusable": a fact about the applicant or a stable stance they will want to give again on OTHER employers' forms (notice period, visa, salary, willingness to relocate, a degree).
- "one_job": it belongs to this one job or employer, even when it does not name it (it names the company or its product, asks why this company, how they heard about this job or employer, whether they worked for or applied to this employer before, which of its offices or teams, a motivation or essay written for this role, a trivia or skill test).
- "consent": a legal or privacy consent / agreement checkbox or statement.
Then covered_by: when one of the applicant's saved answers already settles it, the EXACT saved question (a differently worded notice-period question is covered by the notice period answer; "Do you need visa sponsorship?" by a saved work permit); otherwise "".
And value: the answer to THIS question that saved answer gives: "" when the saved answer answers it as it is; otherwise the short answer it implies (a permanent permit -> "No" to needing sponsorship). Only when it follows for sure: otherwise covered_by "" and value "".
And topic: 2-4 lowercase English words naming what it asks, the SAME words for the same question however it is worded or in whatever language ("notice period", "visa sponsorship", "salary expectation").
And fact: when the question asks for one of the applicant's facts listed in <facts> (street, postal code, name, salutation, notice period, a work permit... in any language and however it is worded), the EXACT fact label from <facts>; otherwise "". A question about something else, or about a fact that is not listed, is "".
And asks: "work_right" when it asks whether the applicant may work somewhere (authorised, eligible, has the right to work), "sponsorship" when it asks whether they need visa sponsorship (now or in the future), else "". And country: for those, the ISO 3166 alpha-2 code of the country it names (a city or region counts for its country), "" when it names none (the job's own location).
And sensitive: true when it asks for a protected or private trait the applicant shares only in that form's own field: equal-opportunity or demographic data (gender, ethnicity, race, sexual orientation, age, veteran status), a disability or health condition, a criminal record; else false. A consent to a background check, a driving licence or a work permit is not sensitive. Sensitive never changes the verdict: a sensitive question the applicant answers the same way on every form stays "reusable".
Answer every label exactly as given; when unsure answer "one_job", "" and "", and sensitive true.`;

// labels, answered: [{question, answer}] -> Map(label -> {reuse, covered_by (an exact answered question or ''), proposal (the deduced answer, else the saved one),
// from (the saved answer it was deduced from: a changed one is judged again)}); a label the AI left out or mangled is absent.
export async function classify({labels, answered = [], facts = [], company = '', host = '', apiKey = '', client = null}) {
  const out = new Map();
  if (!labels.length) return out;
  const ai = client || (apiKey ? anthropicApi(apiKey) : null);
  if (!ai) return out;
  out.usage = {};
  // Why (28 Oct 2026, PR A review): one call for every label hit max_tokens past ~44 verdicts and the cut JSON threw on every read; chunks of CHUNK fit.
  for (let at = 0; at < labels.length; at += CHUNK) {
    const part = await classifyChunk(ai, {labels: labels.slice(at, at + CHUNK), answered, facts, company, host});
    for (const [label, verdict] of part) out.set(label, verdict);
    for (const [name, value] of Object.entries(part.usage || {})) if (typeof value === 'number') out.usage[name] = (out.usage[name] || 0) + value;
  }
  return out;
}

// One call for at most CHUNK labels; a reply cut at max_tokens (or not JSON) judges none of them: they stay unjudged and are asked again on the next read.
async function classifyChunk(ai, {labels, answered, facts, company, host}) {
  const out = new Map();
  const response = await ai.messages.create({
    model: MODEL, max_tokens: 2000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: `<employer>${company}</employer>\n<site>${host}</site>\n<saved_answers>\n${JSON.stringify(answered.map(a => ({question: a.question, answer: String(a.answer || '').slice(0, 300)}))).slice(0, 12000)}\n</saved_answers>\n<facts>\n${JSON.stringify(facts.map(fact => fact.label))}\n</facts>\n<questions>\n${JSON.stringify(labels)}\n</questions>`}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'},
  });
  out.usage = response.usage || {};
  const text = response.content?.find(block => block.type === 'text')?.text || '{"verdicts":[]}';
  let verdicts = [];
  try { verdicts = response.stop_reason === 'max_tokens' ? [] : JSON.parse(text).verdicts || []; } catch { verdicts = []; }
  const byQuestion = new Map(answered.map(a => [a.question, a.answer])), known = new Set(facts.map(fact => fact.label));
  const hidden = new Map();   // label -> sensitive (below): joined to each verdict after the loop
  for (const {label, verdict, covered_by: covered, value = '', topic = '', fact = '', asks = '', country = '', sensitive} of verdicts) {
    // Why (PR D1a, owner 28 Oct 2026: sensitive answers reach no AI reader, only their own form field; lib/about-you.js): anything but a plain false is kept out.
    hidden.set(label, sensitive !== false);
    if (!labels.includes(label) || !VERDICTS.includes(verdict)) continue;
    const eligible = ASKS.includes(asks) && verdict !== 'consent' ? fromEligibility(asks, country, facts) : null;
    // Why (28 Oct 2026, Gitar on #2322): a country no saved zone or nationality covers keeps the question asked; the generic fact path below would hide it
    // and fill it from a row that does not answer it. The row and its value are kept, so an answer added later judges it again (lib/question-verdicts.js).
    if (eligible?.asked) { out.set(label, {reuse: verdict, covered_by: '', proposal: '', from: eligible.from, topic: topicOf(topic), fact: '', asks, row: eligible.row}); continue; }
    if (eligible) { out.set(label, {reuse: DETAILS, covered_by: '', proposal: eligible.value, from: eligible.from, topic: topicOf(topic), fact: eligible.fact, asks, row: ''}); continue; }   // Why (#2322 review): '' drops an asked verdict's row in ensure's merge
    const answer = byQuestion.get(covered) || '', own = known.has(fact) && verdict !== 'consent' ? fact : '';   // a fact the AI invented keeps nothing
    out.set(label, {reuse: own ? DETAILS : verdict, covered_by: answer ? covered : '', proposal: answer ? String(value).trim() || answer : '', from: answer, topic: topicOf(topic), fact: own});
  }
  for (const [label, verdict] of out) verdict.sensitive = hidden.get(label);
  return out;
}

// Why (28 Oct 2026, owner, #2322): "authorised to work in X?", "eligible in the location you apply for?" and "need sponsorship?" are answered from Nationality and
// the zones. The AI says only what the question asks and which country (any language); the code finds the row that covers that country and reads the answer
// from its fixed status (renderer/work-eligibility.js settles). No country named: answered per job from the same rows. -> {fact, value, from}; {asked: true, row,
// from} (row: the zone that covers the country, else Nationality) when Nationality or a zone is saved but settles nothing for that country; null when neither is saved (an older line may still answer it).
function fromEligibility(asks, country, facts) {
  const {nationality, rows} = eligibilityOf(facts), code = String(country || '').trim().toUpperCase();
  if (!nationality && !rows.length) return null;
  if (!code) return {fact: nationality ? NATIONALITY : rows[0].label, value: '', from: ''};
  if (!/^[A-Z]{2}$/.test(code)) return {asked: true, row: '', from: ''};
  // A row with no status (an older "allowed, B permit") answers nothing, so the nationality may (#2322 review).
  const row = rowFor(code, facts.filter(fact => fact.kind !== 'per_country' || splitPermit(fact.value).status)), value = row ? settles(splitPermit(row.value), asks) : '';
  const from = row ? String(facts.find(fact => fact.label === row.label)?.value ?? row.value) : '';   // the saved line, to see it change
  if (value) return {fact: row.label, value, from};
  // Why (28 Oct 2026, #2322 + Gitar): asked, it keeps the one line that could answer it (the zone that covers the country, else Nationality: a country in
  // no zone is answered only by a citizenship of it) and that line's value now, so a change there judges it again.
  const on = ZONES.find(each => each.codes.includes(code))?.label || NATIONALITY;
  return {asked: true, row: on, from: String(facts.find(fact => fact.label === on)?.value ?? '')};
}

// The older shape the fill-time collect uses: the Set of labels worth saving (reusable and not already covered).
export async function reusable(options) {
  const verdicts = await classify(options);
  return new Set([...verdicts].filter(([, v]) => v.reuse === 'reusable' && !v.covered_by).map(([label]) => label));
}
export {keyOf};

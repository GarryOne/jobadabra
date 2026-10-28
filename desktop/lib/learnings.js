// What a form fill teaches about the applicant: one question and answer per topic on the answers page (Profile → What we learned), used by the next fill.
// Why (PR B2, owner 28 Oct 2026: "All of this flow/logic/learning should be heavily controlled/manipulated by the AI. He should interpret meanings. He should
// understand if a learning already exists partially and we should just confirm or extend that learning, or it's a completely new and separate topic"): one
// AI call per fill judges every answer against the existing learnings, given as a closed list: same (evidence only), extends (the AI writes the widened
// answer), conflicts (Two answers), new (a topic of its own), or none of ours: owned (Your details, Strategy), private (right to work, criminal record,
// demographics) or one_job. The code checks the reply's shape and that a picked topic is one of the list, and writes what the verdict says; no word list
// or string compare decides a merge. Sources: answers the fill's AI wrote (state new, guess when unsure) and what the person typed at Submit (confirmed).
// Plan docs/superpowers/plans/2026-10-28-what-we-learned.md (PR B2). Guarded by test/learnings.test.js; prompt cases test/fixtures/learnings-cases.json.
import {KEYS} from '../shared/alias-schema.js';
import {FIELDS} from '../renderer/preferences-model.js';
import {changeFor, sections, withState} from '../renderer/answers-model.js';
import {looksLikeFieldId} from '../renderer/question-filter.js';
import {applyEdits} from './text-outline-handlers.js';
import {openStore} from './store/index.js';
import {log} from './log.js';

export const MODEL = 'claude-haiku-5-5';
export const VERDICTS = ['same', 'extends', 'conflicts', 'new', 'owned', 'private', 'one_job'];
// Where a new learning is written: its own heading, so it never lands inside another section (lib/questions.js QUESTIONS_HEADING does the same for asks).
export const HEADING = 'Learned from forms';
const MAX_ANSWER = 300, MAX_QUESTION = 120, MAX_ITEMS = 40;
// Why (PR B2, owner 28 Oct 2026: "the employment type should be part of the search strategy"): Strategy's own fields are answered from there, never
// learned. Pay is left out: a salary a form asks to state is a learning per country (seeded from Strategy's minimum later); details-side rows are Your details'.
export const STRATEGY_OWNED = FIELDS.filter(field => field.group !== 'pay' && field.editedIn !== 'details').map(field => field.label);

const SCHEMA = {type: 'object', additionalProperties: false, required: ['verdicts'], properties: {verdicts: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['label', 'verdict', 'topic', 'question', 'answer', 'key'], properties: {label: {type: 'string'}, verdict: {type: 'string', enum: VERDICTS},
    topic: {type: 'string'}, question: {type: 'string'}, answer: {type: 'string'}, key: {type: 'string', enum: ['', ...KEYS]}}}}}};
export const INSTRUCTIONS = `A job-application form was just filled. You keep the applicant's learnings: one short question and answer per topic, reused on later forms of ANY employer, whatever their wording or language.
For each answer in <answers> give its verdict against <learnings> (the closed list of existing topics, each with its current answer; an empty answer is a topic still asked):
- "same": a learning on the same topic already says this, however worded. topic: that learning's EXACT question.
- "extends": a learning on the same topic says part of it and this answer adds to it without contradicting it. topic: its EXACT question; answer: the widened answer, short, keeping what the learning said.
- "conflicts": a learning on the same topic says something this answer contradicts. topic: its EXACT question. A topic still asked is never a conflict: say "same".
- "new": no learning has this topic and the applicant would give this answer again on OTHER employers' forms (a stance, a preference, a fact about them). question: a short neutral question naming the topic, in English, naming no employer; answer: the answer, short. Two answers of this form on one new topic get the SAME question.
- "owned": it asks one of <owned> (a fact of the applicant's details or a field of their search strategy), however worded: it is answered from there.
- "private": right to work, work permit, visa or sponsorship, criminal record, disability, health, or a demographic / equal-opportunity question (gender, ethnicity, age, veteran status, pronouns): never kept here.
- "one_job": it belongs to this one employer or job (names it or its product, why this company, how they heard of it, worked or applied there before, which office or team, a motivation text), or it is a legal or privacy consent (data processing, terms). Agreeing to a background check or to travel is a stance: a learning.
A salary to state is per country: its question names the country of the job's place in <job> ("Salary expectation in Germany"); a salary for another country is a new topic, never a conflict.
And key: when the question asks for one of these fixed details of the applicant, its key: ${KEYS.join(', ')}; else "".
Answer every label exactly as given; when unsure answer "one_job".`;

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * One call: the AI's verdict per answer. answers [{label, value}], learnings [{question, answer}], owned [labels], job {company, place}.
 * -> Map(label -> {verdict, topic, question, answer, key}); a label the AI left out, mangled, or gave a topic not in the list is absent (not judged: nothing
 * learned from it). .usage: the call's tokens.
 */
export async function judge(client, {answers, learnings = [], owned = [], job = {}}) {
  const out = new Map();
  if (!client || !answers.length) return out;
  const response = await client.messages.create({
    model: MODEL, max_tokens: 4000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: `<job>${JSON.stringify({company: clean(job.company), place: clean(job.place)})}</job>\n<owned>${JSON.stringify(owned)}</owned>\n`
      + `<learnings>\n${JSON.stringify(learnings.map(each => ({question: each.question, answer: each.answer.slice(0, MAX_ANSWER)})))}\n</learnings>\n`
      + `<answers>\n${JSON.stringify(answers.map(each => ({label: each.label, answer: each.value})))}\n</answers>`}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'},
  });
  out.usage = response.usage || {};
  if (response.stop_reason === 'max_tokens') return out;
  let verdicts = [];
  try { verdicts = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').verdicts || []; } catch { return out; }
  const labels = new Set(answers.map(each => each.label)), topics = new Set(learnings.map(each => each.question));
  for (const {label, verdict, topic = '', question = '', answer = '', key = ''} of verdicts) {
    if (!labels.has(label) || !VERDICTS.includes(verdict) || out.has(label)) continue;
    const onTopic = ['same', 'extends', 'conflicts'].includes(verdict);
    if (onTopic && !topics.has(topic)) continue;   // a topic the list lacks: not judged
    if (verdict === 'extends' && !clean(answer)) continue;
    if (verdict === 'new' && (!clean(question) || clean(question).length > MAX_QUESTION)) continue;
    out.set(label, {verdict, topic: onTopic ? topic : '', question: verdict === 'new' ? clean(question).replace(/[\s:?]+$/, '') : '', answer: clean(answer).slice(0, MAX_ANSWER), key: KEYS.includes(key) ? key : ''});
  }
  return out;
}

/**
 * A fill's answers worth learning from (extension/flow.js debug.answers): the ones the fill's AI wrote, not the kit's (those came from the learnings), and that
 * the form took (a trace row of that label "filled"). -> [{label, value, state: 'guess' (the AI said it was unsure) | 'new'}].
 */
export function fromFill(run) {
  const filled = new Set((run?.trace || []).filter(row => row.outcome === 'filled').map(row => clean(row.label)));
  const labelOf = answer => clean(answer.question || (run?.debug?.form || []).find(field => field.field === answer.field)?.label);
  return (run?.debug?.answers || []).filter(answer => answer.source && answer.source !== 'kit' && filled.has(labelOf(answer)) && typeof answer.value === 'string')
    .map(answer => ({label: labelOf(answer), value: answer.value, state: answer.confidence === 'low' ? 'guess' : 'new'}));
}

// The page's learnings: every labelled line or table row with its question, answer and state (the closed topic list the AI picks from).
export function learningsOf(outline) {
  return sections(outline).flatMap(section => section.items.filter(item => item.kind !== 'note' && item.question).map(item => ({item, question: item.question, answer: item.open ? '' : item.value, section: section.title})));
}

/**
 * What the verdicts write, pure. answers [{label, value, state}] (state: '' typed and so confirmed, 'new' or 'guess' written by the fill's AI); learnings from
 * learningsOf; verdicts from judge. -> {changes (lib/text-outline-handlers.js applyEdits), evidence [{label, topic}], proposals [{key, phrase}], counts}.
 * Invariant: a line changes only as its verdict says; a typed answer replaces a learning no one confirmed (the person corrected the fill's guess).
 */
export function plan(answers, learnings, verdicts, {after = null} = {}) {
  const byQuestion = new Map(learnings.map(each => [each.question, each])), changes = [], evidence = [], proposals = [], fresh = new Map(), touched = new Set();
  const counts = {same: 0, extended: 0, conflicts: 0, added: 0};
  const write = (learning, value, state, other = '') => {
    if (touched.has(learning.question)) return false;   // one write per line per fill: the first answer the form gave wins
    touched.add(learning.question);
    changes.push(changeFor(learning.item, withState(value, state, other)));
    return true;
  };
  for (const answer of answers) {
    const verdict = verdicts.get(answer.label);
    if (!verdict) continue;
    if (verdict.key) proposals.push({key: verdict.key, phrase: answer.label});
    const learning = byQuestion.get(verdict.topic);
    if (verdict.verdict === 'new') {
      if (!fresh.has(verdict.question) && !byQuestion.has(verdict.question)) fresh.set(verdict.question, withState(verdict.answer || answer.value, answer.state));
      evidence.push({label: answer.label, topic: verdict.question});
      continue;
    }
    if (!learning) continue;
    evidence.push({label: answer.label, topic: learning.question});
    const unconfirmed = Boolean(learning.item.state) || !learning.answer;
    if (!learning.answer || (verdict.verdict === 'conflicts' && unconfirmed && !answer.state)) { if (write(learning, answer.value, answer.state)) counts.added++; continue; }
    if (verdict.verdict === 'same') { if (!answer.state && learning.item.state && learning.item.state !== 'conflict') write(learning, learning.answer, ''); counts.same++; continue; }   // typed the same: confirmed
    if (verdict.verdict === 'extends') { if (write(learning, verdict.answer, answer.state || 'new')) counts.extended++; continue; }
    if (verdict.verdict === 'conflicts' && learning.item.state !== 'conflict' && write(learning, learning.answer, 'conflict', answer.value)) counts.conflicts++;
  }
  const lines = [...fresh].map(([question, value]) => `${question}: ${value}`);
  if (lines.length) changes.push(after ? {op: 'insert', after, lines} : {op: 'section', heading: HEADING, lines});
  counts.added += lines.length;
  return {changes, evidence, proposals, counts};
}

/**
 * Learns from one fill's answers. answers [{label, value, state}]; client: the AI engine (lib/ai/index.js client); owned: the labels answered elsewhere
 * (Your details facts and STRATEGY_OWNED); job {company, place}; propose: the meanings pack's proposal channel ({key, phrase}). No client: nothing is
 * learned (not judged = not read on a guess). -> {counts, evidence, judged (the labels the AI judged), usage} or null when nothing was asked.
 */
export async function learn(storage, {answers, client, owned = [], job = {}, fetcher, propose = () => {}}) {
  const wanted = [...new Map((answers || []).map(each => ({label: clean(each.label).replace(/[\s*:]+$/, ''), value: clean(each.value), state: each.state || ''}))
    .filter(each => each.label.length > 1 && each.value && each.value.length <= MAX_ANSWER && !looksLikeFieldId(each.label)).map(each => [each.label, each])).values()].slice(0, MAX_ITEMS);
  if (!client || !wanted.length) return null;
  const page = openStore(storage, {fetcher}).page('answers'), outline = await page.outline(), learnings = learningsOf(outline);
  const verdicts = await judge(client, {answers: wanted, learnings, owned: [...new Set([...owned, ...STRATEGY_OWNED])], job});
  const heading = sections(outline).find(section => section.title === HEADING);
  const {changes, evidence, proposals, counts} = plan(wanted, learnings, verdicts, {after: heading?.after || null});
  const {missing} = changes.length ? await applyEdits(page, outline, changes) : {missing: []};
  if (proposals.length) propose(proposals);
  // Decisions, not content: counts and verdict names, never a question or an answer (lib/log.js).
  log('learnings', `judged ${verdicts.size} of ${wanted.length} answer(s): ${counts.added} learned, ${counts.extended} widened, ${counts.conflicts} with two answers, ${counts.same} confirmed again`,
    {verdicts: [...verdicts.values()].map(each => each.verdict), missing: missing.length});
  return {counts, evidence, judged: [...verdicts.keys()], usage: verdicts.usage || null};
}

// The three lists of open questions, each through the one shared filter (renderer/question-filter.js): Jobs → Answer once (list), Profile → Needs review
// (verdicts, filtered in the window) and the session's "what Claude needs" (groups). Nothing is deleted; `hidden` is what the filter set aside.
// Guarded by test/question-lists.test.js.
import * as questions from './questions.js';
import * as verdicts from './question-verdicts.js';
import * as jobAnswers from './job-answers.js';
import {claudeAi} from './question-ai.js';
import {tidy} from './answers-tidy.js';
import * as formats from './question-formats.js';
import {factsOf} from './base-facts.js';
import {keyOf, ranked, visibleQuestions} from '../renderer/question-filter.js';
import {formatFor, proposalIn} from '../renderer/question-kind.js';
import {letterQuestion} from './letter-availability.js';
import * as detailsReview from './details-review.js';

const answeredNow = async (storage, groups, fetcher) => verdicts.answeredOf(storage, groups ?? await questions.standardAnswers(storage, fetcher));

// The kinds of answer for these labels: what this Mac kept (the last fill's, else the AI's one judgment, asked here for labels with no mark and none kept).
async function keptFormats(storage, rows, ai) {
  const {formats: kept} = await formats.ensure(storage, rows.filter(row => !row.mark?.kind || (row.mark.kind === 'date' && !row.mark.constraints)).map(row => row.question), {ai}).catch(() => ({formats: formats.kept(storage)}));
  return kept;
}
// Each row with the control it is answered with (renderer/question-kind.js formatFor: the store's mark first); a proposal only as one of its options.
const withFormat = (rows, kept) => rows.map(row => {
  const format = formatFor({marked: row.mark, kept: kept[keyOf(row.question)]});
  if (!row.proposal) return {...row, format};
  const proposal = proposalIn(row.proposal, format);
  return proposal ? {...row, format, proposal} : {...row, format, proposal: undefined, coveredBy: undefined};
});

// Jobs → Answer once: {list: shown (a covered question carries .proposal; each row its .format) and Your details' unclear fields (lib/details-review.js:
// one queue, owner 18 Oct 2026), in one scored order, hidden: [...], usage}. A failed read of those leaves the form questions as they are.
export async function openShown(storage, {fetcher, ai = claudeAi(storage), rows = null, groups = null} = {}) {
  if (!rows) await tidy(storage, {fetcher}).catch(() => {});   // the junk an older fill saved goes first (lib/answers-tidy.js)
  const {shown, hidden, fromDetails, usage} = await verdicts.split(storage, rows || await questions.list(storage, fetcher), {answered: await answeredNow(storage, groups, fetcher), facts: await factsOf(storage, fetcher), ai});
  const kept = await keptFormats(storage, shown, ai);
  if (!rows) await detailsReview.judgeNew(storage, {fetcher, ai}).catch(() => {});   // each save: answers saved since the last load get the AI's word (no new line: no call)
  const details = rows ? [] : await detailsReview.pending(storage, {fetcher, ai}).catch(() => []);
  // One score for the whole list (owner, 18 Oct 2026): form questions and Your details items in one order (renderer/question-filter.js ranked).
  return {list: ranked([...withFormat(shown, kept), ...details, ...[letterQuestion(storage)].filter(Boolean)], verdicts.cached(storage)), hidden: withFormat(hidden, kept), fromDetails: fromDetails.length, usage, consent: hidden.filter(row => verdicts.cached(storage)[keyOf(row.question)]?.reuse === 'consent').length};
}

// Profile → Needs review: the verdict map for these labels (classifying new ones), the window filters with visibleQuestions; and the kinds this Mac kept for
// them ({[keyOf]: {kind, options, list}}), the window drawing each row with formatFor (its store mark first). unmarked: the labels whose line has no mark (the AI judges those once).
export async function reviewVerdicts(storage, labels, {ai = claudeAi(storage), groups = null, unmarked = labels} = {}) {
  if (!groups) await tidy(storage).catch(() => {});
  const {verdicts: map, usage} = await verdicts.ensure(storage, labels, {answered: await answeredNow(storage, groups), facts: await factsOf(storage), ai});
  const kept = await keptFormats(storage, unmarked.map(question => ({question})), ai);
  return {verdicts: Object.fromEntries(labels.map(label => [keyOf(label), map[keyOf(label)]]).filter(([, v]) => v)), usage,
    formats: Object.fromEntries(labels.map(label => [keyOf(label), kept[keyOf(label)]]).filter(([, v]) => v))};
}

// "What Claude needs": the standard answers' groups with the open questions the filter hides left out (cached verdicts only, no AI call here).
export function filterGroups(storage, groups) {
  const known = verdicts.cached(storage);
  return groups.map(group => {
    const open = group.items.filter(item => item.open), {shown} = visibleQuestions(open, known);
    return {...group, items: group.items.filter(item => !item.open || shown.some(each => each.question === item.question))};
  }).filter(group => group.items.length);
}

// A job's drawer: this job's questions ({question, state}: one_job / once / remembered).
// This job's questions for its drawer, each with the answer the person kept for this job only when there is one (lib/job-answers.js).
export async function jobQuestions(storage, url, {call} = {}) {
  const list = verdicts.forJob(storage, String(url || ''));
  const mine = await jobAnswers.forUrl(storage, String(url || ''), call ? {call} : {}).catch(() => []);
  const key = text => keyOf(text);
  const merged = list.map(item => ({...item, ...(mine.find(each => key(each.question) === key(item.question)) ? {answer: mine.find(each => key(each.question) === key(item.question)).answer} : {})}));
  return [...merged, ...mine.filter(each => !list.some(item => key(item.question) === key(each.question))).map(each => ({question: each.question, state: 'one_job', answer: each.answer}))];
}
// "Only this job": a remembered question leaves the standard answers and is never kept again.
export async function onlyThisJob(storage, question, {fetcher} = {}) {
  verdicts.onlyThisJob(storage, question);
  return {ok: true, removed: await questions.forget(storage, question, fetcher)};
}

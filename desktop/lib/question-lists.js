// The lists of open questions, each through the one shared filter (renderer/question-filter.js): the two drawers (openShown: Fill your details, What we learned)
// and the session's "what Claude needs" (groups). Nothing is deleted; `hidden` is what the filter set aside.
// Guarded by test/question-queues.test.js and test/question-lists.test.js.
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

const NOT_LEARNED = new Set(['details', 'one_job', 'consent']);   // lib/question-reuse.js verdicts that are never a learning
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

// A details item's place (lib/details-review.js keys: `details:<kind>:<ref JSON>`): a ref with a page is a line of the Profile or the answers page, never a Your details home.
const pageOf = row => { try { return JSON.parse(String(row.key).replace(/^details:[^:]*:/, '')).page || ''; } catch { return ''; } };

// The two drawers (Why (28 Oct 2026, owner, superseding 18 Oct "One queue for all"): "Fill your details" holds only Your details facts; "What we learned"
// everything else that stays reusable, one row per topic, never a per-company question; the cover letter is its own card).
// -> {details: Your details items, ranked; learned: form questions and the Profile's own ❓ lines through the one filter (renderer/question-filter.js) plus the
// saved answers the AI found unclear, ranked; letter: the cover-letter setup action or null; hidden, fromDetails, usage, consent; notLearned: the
// saved answers' questions that are no learning}. A failed read of the
// details leaves the form questions as they are. details: the items as given (tests), else lib/details-review.js pending().
export async function openShown(storage, {fetcher, ai = claudeAi(storage), rows = null, groups = null, details = null} = {}) {
  if (!rows) await tidy(storage, {fetcher}).catch(() => {});   // the junk an older fill saved goes first (lib/answers-tidy.js)
  if (!rows) await detailsReview.judgeNew(storage, {fetcher, ai}).catch(() => {});   // each save: answers saved since the last load get the AI's word (no new line: no call)
  const items = details || (rows ? [] : await detailsReview.pending(storage, {fetcher, ai}).catch(() => []));
  // The Profile's own ❓ lines are questions like a form's: the same AI verdict decides (one job's, consent, a Your details fact, one topic), never their place.
  const asks = items.filter(row => row.details?.kind === 'open' && pageOf(row)), saved = items.filter(row => row.details?.kind !== 'open' && pageOf(row));
  const facts = items.filter(row => !pageOf(row));
  const formRows = [...(rows || await questions.list(storage, fetcher)), ...asks], answered = await answeredNow(storage, groups, fetcher), baseFacts = await factsOf(storage, fetcher);
  // The saved answers get the same verdict in the same one call (AC2: the tab lists no Your details fact, no one job's, no consent); then the one filter.
  const {verdicts: judged, usage} = await verdicts.ensure(storage, [...formRows, ...saved, ...answered].map(row => row.question), {answered, facts: baseFacts, ai});
  const {shown, hidden, fromDetails} = visibleQuestions(formRows, judged, {open: baseFacts.filter(fact => !fact.value).map(fact => fact.label)});
  const kept = await keptFormats(storage, shown.filter(row => !row.details), ai);   // the kinds of what is shown only: a hidden row costs no call
  const known = verdicts.cached(storage), formatted = rows => rows.map(row => (row.details ? row : withFormat([row], kept)[0]));
  // A Profile line merged into a form question's topic is that topic's copy: never answered as another wording (lib/questions.js answers the answers page only).
  const learned = shown.map(row => (row.also?.some(each => each.details) ? {...row, also: row.also.filter(each => !each.details)} : row));
  // Why (28 Oct 2026, spec AC2): a saved answer the AI judged a Your details fact, one job's or consent is not a learning; PR A only leaves it out of the
  // tab; moving it to its Your details home is PR B. Nothing is deleted.
  const notLearned = answered.map(each => each.question).filter(question => NOT_LEARNED.has(known[keyOf(question)]?.reuse));
  // An unclear saved line by the same verdict (PR A review): a Your details fact is checked in Fill your details, one job's or consent is set aside.
  const verdictOf = row => known[keyOf(row.question)]?.reuse;
  const savedFacts = saved.filter(row => verdictOf(row) === 'details'), savedAside = saved.filter(row => NOT_LEARNED.has(verdictOf(row)) && verdictOf(row) !== 'details');
  const savedLearned = saved.filter(row => !NOT_LEARNED.has(verdictOf(row)));
  return {details: ranked([...facts, ...savedFacts], known), learned: ranked([...formatted(learned), ...savedLearned], known), letter: letterQuestion(storage),
    hidden: [...formatted(hidden), ...savedAside],
    fromDetails: fromDetails.length, usage, consent: hidden.filter(row => known[keyOf(row.question)]?.reuse === 'consent').length, notLearned};
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

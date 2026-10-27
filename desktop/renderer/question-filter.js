// Which open questions are worth showing, ONE rule for every list of them (owner, 17 Oct 2026: Jobs → Answer once held the same junk as Profile → Needs review):
// a question shows only when it has a readable label, the AI judged it reusable across jobs (lib/question-verdicts.js keeps that verdict per question), and the
// standard answers do not already cover it (then it shows with the proposed answer to accept). Nothing is deleted: the rest is "hidden" behind a link.
// Pure (no DOM, no AI); guarded by test/question-filter.test.js.
export const keyOf = question => String(question || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The queue items that come from Your details (lib/details-review.js), not from a form: the Profile banner adds them to its own count of the answers page.
/** Queue rows supplied by setup or Your details, counted alongside form questions on every review surface. */
export const extrasIn = list => (list || []).filter(row => row?.details || row?.setup);
export const detailsIn = list => (list || []).filter(row => row?.details);
// The answer "Keep as is" on an answer the AI found unclear (lib/details-review.js): never asked again for that value.
export const KEEP_AS_IS = 'Keep as is';

// A form field's own id where no label was readable ("text-3219", "tel-3519", "question_12"): one token with a digit, no spaces. By shape, no words.
export const looksLikeFieldId = text => {
  const label = String(text || '').replace(/^[\s*]+|[\s*]+$/g, '');
  return !label || (!/\s/.test(label) && /\d/.test(label) && /^[\w.:[\]-]+$/.test(label));
};

// One score for the whole queue (owner, 18 Oct 2026: "sorted by the most important/urgent. Basically scored"). A form question: a fill it blocked first, then
// how many forms asked. A Your details item ("From its form questions"): the sum of the form questions the AI mapped to its fact; one no form asked yet ranks
// right after the blocked questions. Guarded by test/queue-score.test.js.
export const BLOCKED = 1e6;
export const MUST = 1e12;   // a detail the AI rates as needed by nearly every form (lib/contact-review.js): above any fill it blocked
export const weightOf = verdict => (verdict?.blocked ? BLOCKED : 0) + (verdict?.asked || 0);
export function factScore(fact, verdicts = {}) {
  const mine = Object.values(verdicts).filter(verdict => verdict?.reuse === 'details' && keyOf(verdict.fact) === keyOf(fact));
  const blocked = mine.filter(verdict => verdict.blocked).length, asked = mine.reduce((sum, verdict) => sum + (verdict.asked || 0), 0);
  return blocked ? blocked * BLOCKED + asked : BLOCKED - 1000 + Math.min(asked, 999);
}
// The queue in one order, highest score first; equal scores keep their place.
export function ranked(list, verdicts = {}) {
  const scoreOf = row => (row.setup ? row.weight || MUST : row.details ? Math.max(row.details.weight || 0, factScore(row.details.fact || row.question, verdicts)) : weightOf(verdicts[keyOf(row.question)]));
  return (list || []).map((row, at) => ({row, at, score: scoreOf(row)})).sort((a, b) => b.score - a.score || a.at - b.at).map(each => each.row);
}

// A question that means a fact of Your details ({reuse: 'details', fact}) is answered from there and never shown (owner, 17 Oct 2026): it is counted apart (fromDetails),
// not "hidden". A fact with no value yet (options.open: its labels) answers nothing: its questions are asked once, as that Your details item (viaDetails;
// owner, 18 Oct 2026: "Ask once"). Same-topic wordings (any language) are ONE item: the first carries the others in .also, and answering it answers them all.
// verdicts: {[keyOf(question)]: {reuse: 'reusable' | 'one_job' | 'consent' | 'details', covered_by: '' | an answered question, proposal: its answer, asked: how many forms}}.
// rows: anything with .question. → {shown: rows (covered ones carry .proposal; most-asked first), hidden: rows}.
export function visibleQuestions(rows, verdicts = {}, {open = []} = {}) {
  const shown = [], hidden = [], fromDetails = [], viaDetails = [], empty = new Set(open.map(keyOf));
  for (const row of rows) {
    const verdict = verdicts[keyOf(row.question)];
    if (verdict?.reuse === 'details' && !looksLikeFieldId(row.question)) (empty.has(keyOf(verdict.fact)) ? viaDetails : fromDetails).push(row);
    else if (looksLikeFieldId(row.question) || (verdict && verdict.reuse !== 'reusable')) hidden.push(row);
    else shown.push(verdict?.covered_by && verdict.proposal ? {...row, proposal: verdict.proposal, coveredBy: verdict.covered_by} : row);
  }
  // value first: a question that blocked a fill, then the most asked
  shown.sort((a, b) => weightOf(verdicts[keyOf(b.question)]) - weightOf(verdicts[keyOf(a.question)]));
  const byTopic = new Map(), one = [];
  for (const row of shown) {
    const topic = (verdicts[keyOf(row.question)] || {}).topic;
    const first = topic && byTopic.get(topic);
    if (first) first.also = [...(first.also || []), row];
    else { const copy = {...row}; one.push(copy); if (topic) byTopic.set(topic, copy); }
  }
  return {shown: one, hidden, fromDetails, viaDetails};
}

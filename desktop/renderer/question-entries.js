// The Jobs drawers as rows of Focus → Suggestions and the Jobs bar: Cover letter, Fill your details and What we learned, from the count Jobs already reads
// (pages/jobs-questions.js questionsNow), free of the DOM so the tests can check them. Spec: docs/superpowers/specs/2026-10-28-insights-with-actions-design.md (PR 1c).
// Guarded by test/question-entries.test.js.
import {fromDetailsLine} from './answered-from-details.js';
import {questionsProblem} from './questions-view.js';

// Every actions[].do these rows write, each run by pages/focus-suggestions.js RUN (listed in suggestions.js DOES).
export const QUESTION_DOES = ['open_letter', 'open_details', 'open_learned', 'retry_questions'];
const COUNT = {details: n => `${n} missing`, learned: n => `${n} to check`};   // pages/jobs-questions.js countText: one wording on the card, the tab and here

// A row of the pool's shape (src/suggestions.py _entry) built in the window; `short` is its words in the folded bar's line. Counts, not guesses: ⋯ holds Not now only (spec).
const row = (kind, fields) => ({kind, home: 'jobs', topic: 'applying', source: 'Applying', evidence: [], answers: ['Not now'], blocking: false, ...fields});

/**
 * The drawers' rows from what Jobs read ({details, learned, letter, error, fromDetails}): [] while each is at zero, one error row when the read failed with
 * nothing saved to show (and the store is connected), else letter, details, learned. A failed refresh keeps the counts saved on this Mac, as the old cards
 * did (Gitar on #2366). Never throws: a window that has not read yet has nothing to say.
 */
export function questionEntries({details = [], learned = [], letter = null, error = '', fromDetails = 0} = {}) {
  if (error && !details.length && !learned.length && !letter) {
    if (questionsProblem(error).hide) return [];   // the store not connected yet (trying only): no error row, as the card
    return [row('questions-error', {key: 'questions:error', title: 'Couldn\'t load your details', short: 'Couldn\'t load your details', detail: questionsProblem(error).text,
      actions: [{label: 'Retry', do: 'retry_questions'}], answers: []})];
  }
  const found = [];
  if (letter) {
    found.push(row('letter', {key: 'letter:setup', title: 'Cover letter missing', short: 'Cover letter missing', detail: letter.hint || '', source: 'Cover letter', blocking: true,
      actions: [{label: letter.setup?.action || 'Set up cover letter', do: 'open_letter'}]}));
  }
  if (details.length) {
    found.push(row('details', {key: 'details:open', title: 'Fill your details', short: `${details.length} details missing`, detail: [COUNT.details(details.length), fromDetails > 0 ? fromDetailsLine(fromDetails) : ''].filter(Boolean).join(' · '),
      actions: [{label: 'Fill your details', do: 'open_details'}]}));
  }
  if (learned.length) {
    found.push(row('learned', {key: 'learned:open', title: 'What we learned', short: COUNT.learned(learned.length), detail: COUNT.learned(learned.length),
      actions: [{label: 'Check what we learned', do: 'open_learned'}]}));
  }
  return found;
}

/**
 * The rows a screen may draw: none until Focus has said which keys a Not now still hides (`known`), then without those and the ones answered here (`held`).
 * Why (#2366, Gitar): the Jobs bar drew a row answered Not now on another Mac, or before a restart, until Focus was read.
 */
export const drawerRows = (rows, {held, hidden, known}) => (known ? rows.filter(row => !held.has(row.key) && !hidden.has(row.key)) : []);

/** The pool with the question rows on top (the blocking one first), without the keys answered Not now here: [rows..., entries...]. */
export const withQuestions = (entries, rows, held = new Set()) => [...rows.filter(item => !held.has(item.key)), ...(entries || [])];

/** The folded Jobs bar's line, the blocking one first: "Cover letter missing · 4 details missing · 6 to check · 3 search suggestions". '' when nothing shows. */
export function foldedLine(rows, searchCount) {
  const parts = rows.map(item => item.short);
  if (searchCount > 0) parts.push(`${searchCount} search suggestion${searchCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

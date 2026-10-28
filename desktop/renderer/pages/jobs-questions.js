// The open questions of the two drawers and the cover letter's action (owner, 28 Oct 2026; insights PR 1c: they are rows of the Jobs bar and of Focus →
// Suggestions, renderer/question-entries.js, no longer cards on Jobs): "Fill your details · N missing", "What we learned · N to check", each opening its
// drawer (pages/question-review.js, one question at a time). One count per drawer everywhere: those rows, its Profile tab's count and the drawer's header read
// the same list (questionsNow). It reads the open questions (cached on this computer first, then the store) and keeps them for the drawer.
// Guarded by: test/question-drawers.test.js, test/question-review.test.js, questions-load-error.test.js, questions-error-text.test.js, test/question-entries.test.js.
import {$, show} from './core.js';

// The questions saved last time are used at once (cached on this computer), then the store's answer replaces them.
const QUESTIONS_CACHE = 'questionsCache2';   // {details, learned, letter, notLearned}; the one-list cache of before 28 Oct 2026 is not read
let questionsShown = '';
const now = {details: [], learned: [], letter: null, hidden: [], consent: 0, fromDetails: 0, notLearned: [], error: '', read: false};
// What the drawers walk through: Your details items (details), the reusable questions (learned), the cover-letter action (letter), the set-aside ones (hidden),
// the consent count, the saved answers that are no learning (notLearned: Profile → What we learned leaves them out), the last error, and whether the store answered yet.
export const questionsNow = () => now;
// Reading the questions walks the whole answers page (about 50 Notion calls, which queue ahead of every other read): not on every Jobs reload (each save, dismiss, kit…).
// It is read again at the first load, after 10 minutes, and at once when something changed it: Retry, an answer, a fill that added questions (`onMoved`, from lib/server.js).
const QUESTIONS_FRESH_MS = 10 * 60 * 1000;
let questionsReadAt = 0;
// One read at a time: the Jobs card and the drawer asking together share the store's answer (17 Oct 2026: both started the ~50-call walk).
let reading = null;
export function loadQuestions({force = false} = {}) {
  if (reading && !force) return reading;
  const after = reading || Promise.resolve();   // a forced read (an answer was saved) starts after the one under way, which may have missed it
  const job = after.then(() => readQuestions({force})).finally(() => { if (reading === job) reading = null; });
  reading = job;
  return job;
}
async function readQuestions({force}) {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(QUESTIONS_CACHE) || 'null'); } catch {}
  if (!Array.isArray(cached?.details) || !Array.isArray(cached?.learned)) cached = null;
  if (!questionsShown && cached) { renderQuestions(cached); document.dispatchEvent?.(new Event('questions-read')); }   // the rows draw from what was kept on this Mac, then from the store's answer
  if (!force && questionsReadAt && Date.now() - questionsReadAt < QUESTIONS_FRESH_MS && cached) return;   // fresh enough: what is shown stands
  const {details = [], learned = [], letter = null, hidden = [], consent = 0, fromDetails = 0, notLearned = [], error} = await window.pilot.openQuestions();
  if (!error) questionsReadAt = Date.now();
  if (error && cached) { Object.assign(now, {error, read: true}); return; }  // the store unreachable: keep the saved questions
  if (!error) try { localStorage.setItem(QUESTIONS_CACHE, JSON.stringify({details, learned, letter, notLearned})); } catch {}
  renderQuestions({details, learned, letter, notLearned}, error, hidden, consent, fromDetails);
  now.read = true;
  document.dispatchEvent?.(new Event('questions-read'));   // the other counts of this queue (Profile banner, Your details' "To check") draw again
}

// "N missing" / "N to check": the one count of each drawer, on its row (question-entries.js) and its Profile tab (index.html #tab-count-details, #tab-count-answers).
export const countText = {details: n => `${n} missing`, learned: n => `${n} to check`};
function drawCount(id, n, text) {
  if ($(id)) $(id).textContent = n ? text(n) : '';
  if ($(id)) show($(id), n > 0);   // a window without it (another page's test harness) is left alone
}

function renderQuestions({details = [], learned = [], letter = null, notLearned = []}, error = '', hidden = [], consent = 0, fromDetails = null) {
  Object.assign(now, {details, learned, letter, hidden, consent, notLearned, error: error || '', ...(fromDetails === null ? {} : {fromDetails})});
  const shown = JSON.stringify([details.length, learned.length, letter?.setup?.state || '', error, now.fromDetails]);
  if (shown === questionsShown) return;
  questionsShown = shown;
  drawCount('tab-count-details', error ? 0 : details.length, countText.details);
  drawCount('tab-count-answers', error ? 0 : learned.length, countText.learned);
}

// A letter was drafted, approved or its availability changed: the derived setup action must refresh immediately.
document.addEventListener('letter-updated', () => loadQuestions({force: true}));

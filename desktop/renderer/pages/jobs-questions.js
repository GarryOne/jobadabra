// Jobs page: the two drawers' compact cards and the cover letter's (owner, 28 Oct 2026, superseding 17 Oct's one "Application questions" card): "Fill your
// details · N missing" (amber) and "What we learned · N to check" (blue), each hidden at zero, each opening its drawer (pages/question-review.js, one question at
// a time); the cover letter is its own card, never a question. One count per drawer everywhere: this card, its Profile tab's count and the drawer's header read
// the same list (questionsNow). It reads the open questions (cached on this computer first, then the store) and keeps them for the drawer.
// Guarded by: test/question-drawers.test.js, test/question-review.test.js, questions-load-error.test.js, questions-error-text.test.js.
import {el, cardOpens} from '../components.js';
import {$, show} from './core.js';
import {questionsProblem} from '../questions-view.js';
import {fromDetailsLine} from '../answered-from-details.js';

// The questions saved last time show at once (cached on this computer), then the store's answer replaces them. No cache yet: a shimmer where the count goes.
const QUESTIONS_CACHE = 'questionsCache2';   // {details, learned, letter, notLearned}; the one-list cache of before 28 Oct 2026 is not read
let questionsShown = '';
const now = {details: [], learned: [], letter: null, hidden: [], consent: 0, fromDetails: 0, notLearned: [], error: '', read: false};
// What the drawers walk through: Your details items (details), the reusable questions (learned), the cover-letter action (letter), the set-aside ones (hidden),
// the consent count, the saved answers that are no learning (notLearned: Profile → What we learned leaves them out), the last error, and whether the store answered yet.
export const questionsNow = () => now;
for (const [card, button] of [['questions', 'questions-review'], ['learned', 'learned-review'], ['letter-setup', 'letter-setup-go']]) if ($(card) && $(button)) cardOpens($(card), $(button));   // the whole card opens it
$('questions-retry')?.addEventListener('click', () => { questionsShown = ''; loadQuestions({force: true}); });
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
  if (!questionsShown) {
    if (cached) renderQuestions(cached);
    else {
      $('questions').classList.add('is-loading');
      $('questions-count').replaceChildren(el('span', 'skeleton questions-skeleton'));
      show($('questions'));
    }
  }
  if (!force && questionsReadAt && Date.now() - questionsReadAt < QUESTIONS_FRESH_MS && cached) return;   // fresh enough: what is shown stands
  const {details = [], learned = [], letter = null, hidden = [], consent = 0, fromDetails = 0, notLearned = [], error} = await window.pilot.openQuestions();
  $('questions').classList.remove('is-loading');
  if (!error) questionsReadAt = Date.now();
  if (error && cached) { Object.assign(now, {error, read: true}); return; }  // the store unreachable: keep the saved questions
  if (!error) try { localStorage.setItem(QUESTIONS_CACHE, JSON.stringify({details, learned, letter, notLearned})); } catch {}
  renderQuestions({details, learned, letter, notLearned}, error, hidden, consent, fromDetails);
  now.read = true;
  document.dispatchEvent?.(new Event('questions-read'));   // the other counts of this queue (Profile banner, Your details' "To check") draw again
}

// "N missing" / "N to check": the one count of each drawer, on its card and its Profile tab (index.html #tab-count-details, #tab-count-answers).
export const countText = {details: n => `${n} missing`, learned: n => `${n} to check`};
// A card or count shown or hidden by id; a window without it (another page's test harness) is left alone.
const showId = (id, on) => { if ($(id)) show($(id), on); };
function drawCount(id, n, text) {
  if ($(id)) $(id).textContent = n ? text(n) : '';
  showId(id, n > 0);
}

function renderQuestions({details = [], learned = [], letter = null, notLearned = []}, error = '', hidden = [], consent = 0, fromDetails = null) {
  Object.assign(now, {details, learned, letter, hidden, consent, notLearned, error: error || '', ...(fromDetails === null ? {} : {fromDetails})});
  const shown = JSON.stringify([details.length, learned.length, letter?.setup?.state || '', error, now.fromDetails]);
  if (shown === questionsShown) return;
  questionsShown = shown;
  drawCount('tab-count-details', error ? 0 : details.length, countText.details);
  drawCount('tab-count-answers', error ? 0 : learned.length, countText.learned);
  showId('letter-setup', !error && Boolean(letter));
  if (letter && $('letter-setup-hint')) { $('letter-setup-hint').textContent = letter.hint || ''; $('letter-setup-go').textContent = letter.setup?.action || 'Set up cover letter'; }
  // Each card shows when its drawer has something; a failed read shows on Fill your details; the store not connected yet (trying only): no error card.
  if (error && questionsProblem(error).hide) { show($('questions'), false); showId('learned', false); return; }
  show($('questions'), details.length > 0 || !!error);
  showId('learned', !error && learned.length > 0);
  $('questions-count').textContent = error ? 'couldn\'t load' : countText.details(details.length);
  if ($('learned-count')) $('learned-count').textContent = countText.learned(learned.length);
  $('questions-details').textContent = fromDetailsLine(now.fromDetails);
  show($('questions-details'), !error && now.fromDetails > 0);
  $('questions-error').textContent = error ? questionsProblem(error).text : '';
  show($('questions-error'), !!error);
  show($('questions-retry'), !!error);
  show($('questions-review'), !error);
}

// A letter was drafted, approved or its availability changed: the derived setup action must refresh immediately.
document.addEventListener('letter-updated', () => loadQuestions({force: true}));

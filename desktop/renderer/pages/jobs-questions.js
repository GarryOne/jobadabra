// Jobs page, Application questions (owner's mockup, 17 Oct 2026: "Replace 'Answer once' with one compact card"): a title, "N need review" (the
// review queue's count, never the set-aside ones), one line and Review questions (pages/question-review.js, one question at a time; the whole card opens it, Saved answers is in the drawer's header). It reads the open questions (cached list first, then the store) and keeps them for the drawer (questionsNow).
// Guarded by: test/question-review.test.js, questions-load-error.test.js, questions-error-text.test.js.
import {el, cardOpens} from '../components.js';
import {$, show} from './core.js';
import {questionsProblem} from '../questions-view.js';
import {fromDetailsLine} from '../answered-from-details.js';

// The questions saved last time show at once (cached on this computer), then the store's answer replaces them. No cache yet: a shimmer where the count goes.
const QUESTIONS_CACHE = 'questionsCache';
let questionsShown = '';
const now = {list: [], hidden: [], consent: 0, fromDetails: 0, error: '', read: false};
// What the drawer walks through: the queue (list), the set-aside ones (hidden), the consent count, the last error, and whether the store answered yet.
export const questionsNow = () => now;
if ($('questions') && $('questions-review')) cardOpens($('questions'), $('questions-review'));   // the whole card opens the drawer
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
  if (!questionsShown) {
    if (Array.isArray(cached)) renderQuestions(cached);
    else {
      $('questions').classList.add('is-loading');
      $('questions-count').replaceChildren(el('span', 'skeleton questions-skeleton'));
      show($('questions'));
    }
  }
  if (!force && questionsReadAt && Date.now() - questionsReadAt < QUESTIONS_FRESH_MS && Array.isArray(cached)) return;   // fresh enough: what is shown stands
  const {list, hidden = [], consent = 0, fromDetails = 0, error} = await window.pilot.openQuestions();
  $('questions').classList.remove('is-loading');
  if (!error) questionsReadAt = Date.now();
  if (error && Array.isArray(cached)) { Object.assign(now, {error, read: true}); return; }  // the store unreachable: keep the saved questions
  if (!error) try { localStorage.setItem(QUESTIONS_CACHE, JSON.stringify(list)); } catch {}
  renderQuestions(list || [], error, hidden, consent, fromDetails);
  now.read = true;
  document.dispatchEvent?.(new Event('questions-read'));   // the other counts of this queue (Profile banner, Your details' "To check") draw again
}

function renderQuestions(list, error = '', hidden = [], consent = 0, fromDetails = null) {
  list = list.filter(item => item.details?.kind !== 'where');   // legacy cached home pickers: the app now organizes these sources itself
  Object.assign(now, {list, hidden, consent, error: error || '', ...(fromDetails === null ? {} : {fromDetails})});
  const high = list.filter(row => row.priority === 'HIGH PRIORITY').length;
  const shown = JSON.stringify([list.length, high, error, now.fromDetails]);
  if (shown === questionsShown) return;
  questionsShown = shown;
  // Shown whenever there's something to review or a read failed; the store not connected yet (trying only): nothing to read, so no error card.
  if (error && questionsProblem(error).hide) { show($('questions'), false); return; }
  show($('questions'), list.length > 0 || !!error);
  $('questions-count').textContent = error ? 'couldn\'t load' : `${list.length} need${list.length === 1 ? 's' : ''} review${high ? ` · ${high} HIGH PRIORITY` : ''}`;
  $('questions-details').textContent = fromDetailsLine(now.fromDetails);
  show($('questions-details'), !error && now.fromDetails > 0);
  $('questions-error').textContent = error ? questionsProblem(error).text : '';
  show($('questions-error'), !!error);
  show($('questions-retry'), !!error);
  show($('questions-review'), !error);
}

// A letter was drafted, approved or its availability changed: the derived setup action must refresh immediately.
document.addEventListener('letter-updated', () => loadQuestions({force: true}));

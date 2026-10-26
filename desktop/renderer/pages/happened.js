// Focus → "Did the interview happen?" (src/focus.py 'happened': its time passed and nothing was recorded).
// Yes: your notes become a 🎤 Interviews row, the job moves on, and a few lines get Claude's review (on this Mac, or on
// GitHub when Always on). No: moved to a new date (Next interview) or cancelled (an event; the stage stays).
import {aiName} from '../ai-name.js';
import {$, aiReady, message, show} from './core.js';
import {loadFocus} from './focus.js';
import {loadJobs} from './jobs.js';
import {toastMessage} from './startup.js';
import {storeName} from '../store-words.js';

let current = null;  // {item, answer: 'yes' | 'no'}
const who = item => item.company || item.via || 'the recruiter';

export function openHappened(item, answer) {
  current = {item, answer};
  const at = item.at ? new Date(item.at) : null;
  $('happened-title').textContent = answer === 'yes' ? 'How did it go?' : "The interview didn't happen";
  $('happened-context').textContent = `${who(item)} · ${item.job || 'Interview'}${at ? ` · ${at.toLocaleString([], {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}` : ''}`;
  show($('happened-yes'), answer === 'yes');
  show($('happened-no'), answer !== 'yes');
  $('happened-notes').value = '';
  $('happened-at').value = '';
  $('happened-save').disabled = false;
  message('happened-message', '');
  $('happened-dialog').showModal();
  (answer === 'yes' ? $('happened-notes') : $('happened-at')).focus();
}

// A few lines of notes: Claude reviews them like a transcript (the same review as a recording), in the background.
async function review(pageId, item) {
  if (!aiReady()) {
    toastMessage('Saved ✓', 'Choose your AI in Settings (Claude Code, Codex or an API key) to get a review of your notes (Interviews → Review).', {card: 'ai'}, 'good');
    return;
  }
  toastMessage('Saved ✓', `${aiName()} is reviewing your notes on ${who(item)} (about a minute).`, {view: 'interviews'}, 'good');
  const result = await window.pilot.interviews.review(pageId).catch(error => ({ok: false, error: error.message}));
  toastMessage(result.ok ? 'Interview reviewed' : 'Review failed', result.ok ? result.summary : result.error || 'Try again from Interviews.', {view: 'interviews'}, result.ok ? 'good' : 'bad');
  loadFocus();
  loadJobs();
}

async function save() {
  const {item, answer} = current;
  let detail = {};
  let kind = 'held';
  if (answer === 'yes') detail = {notes: $('happened-notes').value.trim()};
  else {
    kind = document.querySelector('input[name="happened-why"]:checked')?.value || 'moved';
    if (kind === 'moved') {
      const value = $('happened-at').value;
      if (!value) { message('happened-message', 'Pick the new date and time, or choose Cancelled.', 'warn'); return false; }
      detail = {at: new Date(value).toISOString()};
    }
  }
  $('happened-save').disabled = true;
  const result = await window.pilot.interviewHappened(item.page_id, kind, detail).catch(error => ({ok: false, error: error.message}));
  $('happened-save').disabled = false;
  if (!result.ok) { message('happened-message', result.error || `${storeName()} could not save it. Try again.`, 'warn'); return false; }
  $('happened-dialog').close();
  if (kind === 'held' && result.review && result.id) review(result.id, item);
  else toastMessage('Saved ✓', {held: `${who(item)}: marked as held${result.stage ? `, now ${result.stage}` : ''}.`,
    moved: `${who(item)}: the interview is on the new date.`, cancelled: `${who(item)}: logged as cancelled.`}[kind], {view: 'interviews'}, 'good');
  loadFocus();
  loadJobs();
  return true;
}

// Give up on an interview (Up next ⋯, or the ✕ on a calendar event): after a confirmation, an "Interview cancelled" event
// in Notion and the Next interview cleared; the job's stage stays. onConfirmed runs as soon as the user says yes, onDone once Notion has it, onFail if it refused.
export async function dismissInterview({page_id, company, via}, {onConfirmed = () => {}, onDone = () => {}, onFail = () => {}} = {}) {
  const name = company || via || 'this recruiter';
  if (!confirm(`Dismiss the interview with ${name}?\n\nIt leaves Up next and the calendar and is logged as cancelled in ${storeName()}. The job itself stays as it is.`)) return false;
  onConfirmed();   // the row leaves the list at once; Notion takes seconds
  const result = await window.pilot.interviewHappened(page_id, 'cancelled', {}).catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { onFail(); toastMessage('Not saved', result.error || `${storeName()} could not save it. Try again.`, {view: 'interviews'}, 'bad'); return false; }
  toastMessage('Dismissed ✓', `${name}: the interview is logged as cancelled.`, {view: 'interviews'}, 'good');
  onDone();
  loadFocus();
  loadJobs();
  return true;
}

export function init() {
  $('happened-at').addEventListener('focus', () => { document.querySelector('input[name="happened-why"][value="moved"]').checked = true; });
  $('happened-save').addEventListener('click', event => { event.preventDefault(); save(); });
}

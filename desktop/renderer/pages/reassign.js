// Where an email belongs, in your words: Focus → "Is this about …?" (an email the Gmail check wasn't sure about).
// One dialog: pick the job, a new job, or "not about a job"; src/ai/reassign.py attaches the email (Notion stays the
// one copy).
import {shared} from './shared.js';
import {$, message} from './core.js';
import {loadFocus, holdItem, releaseItem} from './focus.js';
import {loadJobs} from './jobs.js';
import {toastMessage} from './startup.js';
import {searchSelect} from '../search-select.js';
import {CHOICES, emailNoun, questionWhy} from '../question-words.js';
import {el} from '../components.js';
import {storeName} from '../store-words.js';

const option = (value, text) => Object.assign(document.createElement('option'), {value, textContent: text});
const labelOf = job => `${job.company || job.via || '—'} · ${job.title}${job.stage ? ` (${job.stage})` : ''}`;

// The job picker holds only the jobs you track; "a new job" and "not about a job" are their own choices.
function targets(current = '', suggested = '') {
  const tracked = shared.allJobs.filter(job => job.stage && !['Dismissed', 'Closed'].includes(job.stage) && job.url !== current)
    .sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  $('reassign-target').replaceChildren(...tracked.map(job => option(job.url, labelOf(job))));
  const known = suggested && tracked.some(job => job.url === suggested);
  if (known) $('reassign-target').value = suggested;
  $('reassign-choices').querySelector('[value=tracked]').disabled = !tracked.length;
  choose(known ? 'tracked' : 'new');
}
const chosen = () => $('reassign-choices').querySelector('input:checked')?.value || 'new';
// A choice: its radio, the picker only for a tracked job, the line under the list and the button say what Save does.
function choose(value) {
  $('reassign-choices').querySelector(`[value=${value}]`).checked = true;
  $('reassign-pick').hidden = value !== 'tracked';
  $('reassign-help').textContent = CHOICES[value].note;
  $('reassign-save').textContent = CHOICES[value].save;
}
const target = () => (chosen() === 'tracked' ? $('reassign-target').value : chosen());

let pending = null;  // () => Promise<boolean>: what Save does in the dialog now open

// The header: what the email is (sender · when), and, muted, why it is asked.
function open({title, context, why = ''}) {
  $('reassign-title').textContent = title;
  $('reassign-context').replaceChildren(context || '', ...(why ? [el('span', 'small muted', why)] : []));
  message('reassign-message', '');
  $('reassign-save').disabled = false;
  $('reassign-dialog').showModal();
}

export async function moveEmail(eventId, target, item = null) {
  if (item) holdItem(item);   // the question leaves Focus at once ("Saving…"); Notion takes seconds
  const result = await window.pilot.reassignEmail(eventId, target).catch(error => ({ok: false, text: error.message}));
  toastMessage(result.ok ? 'Saved ✓' : 'Not changed', result.text || '', {view: 'focus'}, result.ok ? 'good' : 'bad');
  if (result.ok) { loadFocus(); loadJobs(); } else if (item) releaseItem(item);
  return result.ok;
}

// Focus → Other job…: the question's email, to the job you pick. `onSaved(job)` hears the job saved ("Company — Title", or ''
// for "not about a job"): Recent activity's Gmail card turns that email to "Answered" at once.
const jobOf = (choice, item) => (choice === 'none' ? '' : choice === 'new' ? `${item.company || 'New job'} — new job`   // as the answered list records it
  : ($('reassign-target').selectedOptions[0]?.textContent || '').replace(/\s*\([^)]*\)$/, '').replace(' · ', ' — '));
export function whichJob(item, onSaved = null) {
  targets('', item.suggested_url);
  pending = async () => {
    const choice = chosen();
    const ok = await moveEmail(item.event_id, target(), item);
    if (ok && onSaved) onSaved(jobOf(choice, item));
    return ok;
  };
  open({title: 'Which job is this email about?', context: item.detail,
    why: questionWhy(emailNoun({subject: item.subject}), item.company)});
}

export async function init() {
  searchSelect($('reassign-target'));
  $('reassign-choices').addEventListener('change', () => choose(chosen()));
  $('reassign-save').addEventListener('click', async event => {
    event.preventDefault();
    if (!pending) return;
    $('reassign-save').disabled = true;
    message('reassign-message', `Saving to ${storeName()}…`, 'waiting');
    const ok = await pending();
    $('reassign-save').disabled = false;
    if (ok) $('reassign-dialog').close(); else message('reassign-message', 'Not saved. Try again.', 'error');
  });
}

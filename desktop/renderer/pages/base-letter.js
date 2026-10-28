// Settings → Profile → Cover letter → Base letter (owner's mockup 07, 18 Oct 2026; moved from pages/profile.js): a neutral "Not created" with Draft with AI
// and Write my own, the editor only after a choice or once a letter exists; then draft → Approve & make PDF → approved (its date and Open PDF).
// Approved usable base letters automatically fill the gap when a job has no usable tailored letter. Who pays is said before and after a draft.
// A job's own letter lives in its preparation kit (job-drawer/job-letter.js). Guarded by test/base-letter.test.js and test/contact-reading.test.js.
import {pill} from '../components.js';
import {emptyState} from '../page-parts.js';
import {profileBar} from './profile-save-bar.js';
import {$, message, runWhen, show} from './core.js';
import {shared} from './shared.js';
import {reading} from '../contact-reading.js';
import {swr} from '../swr.js';
import {hintAfter} from '../own-key-hint.js';
import {lastCost, usageAfter, usageBefore} from '../ai-engine-view.js';
import {aiWriting} from '../ai-writing.js';

let saved = {state: 'none', text: ''};   // the letter as stored: the buttons and the view follow what differs from it
let draftPending = null; // one generation across clicks and wizard navigation; never spend twice for the same in-flight draft
let writing = false;                     // "Write my own" pressed: the editor stays open on an empty letter
let isReading = false;
let drafting = false;                    // the AI is writing a draft: the pill says so, the kept letter shows faded under the strip (ai-writing.js)
let draftSource = null;                 // the typed letter as a draft on Profile's one save bar
let openAi = () => {};                   // Settings → Connections → AI, passed in by pages/profile.js (no import of the settings page here)

// The state as a pill: neutral while none exists (owner, 18 Oct 2026: never a green dot for "not written"); Writing… while a draft is written.
// Why (28 Oct 2026, owner's shot): the card said "Approved · Today 19:40" while a new draft was being written over it.
export function statePill(status, {drafting: busy = false} = {}) {
  if (busy) return pill('Writing…', 'info');
  if (status.state === 'approved') return pill(`Approved${status.approvedAt ? ` · ${runWhen(status.approvedAt)}` : ''}`, 'good');
  if (status.state === 'draft') return pill('Draft · approve to use it', 'warn');
  return pill('Not created');
}
// Which part shows: the empty state (two choices) or the editor. Reading shows the editor, its box a skeleton (contact-reading.js); a first draft being
// written shows it too, the letter's shape in skeleton lines under the strip (ai-writing.js).
export const showsEditor = (status, {writing: own = false, reading: busy = false, typed = '', drafting: ai = false} = {}) => ai || busy || own || status.state !== 'none' || !!String(typed).trim();

const usageLine = () => [usageBefore(shared.state?.settings, !!shared.state?.secrets?.ANTHROPIC_API_KEY), lastCost(saved)].filter(Boolean).join(' ');

// The empty state (page-parts.js emptyState), drawn again each paint so its usage note follows the engine; its buttons keep their ids (⌘K, tests).
function drawEmpty() {
  const box = emptyState({icon: 'file', chip: '', title: 'No base letter yet', text: 'Draft one with AI from your CV, Profile and writing preferences, or write your own.',
    actions: [{label: 'Draft with AI', ai: true, run: () => draft($('letter-start-ai'))}, {label: 'Write my own', run: () => { writing = true; paint(); $('letter-text').focus(); }}], note: usageLine()});
  const [ai, own] = box.querySelectorAll('button');
  ai.id = 'letter-start-ai';
  own.id = 'letter-own';
  $('letter-empty').replaceChildren(box);
}
function paint() {
  const editor = showsEditor(saved, {writing, reading: isReading, typed: $('letter-text').value, drafting});
  show($('letter-editor'), editor);
  show($('letter-empty'), !editor);
  if (!editor) drawEmpty();
  $('letter-state').replaceChildren(isReading ? pill('Reading…') : statePill(saved, {drafting}));
  $('letter-draft').querySelector('span').textContent = drafting ? 'Writing…' : saved.text ? 'Redraft with AI' : 'Draft with AI';
  show($('letter-pdf'), !!saved.pdf);
  document.querySelectorAll('[data-letter-usage]').forEach(node => { node.textContent = usageLine(); });
  buttons();
}
const typedChange = () => { const text = $('letter-text').value.trim(); return text && text !== (saved.text || '').trim() ? 1 : 0; };
function buttons() {
  const text = $('letter-text').value.trim();
  // Why (28 Oct 2026, code review): paint() runs mid-draft; Approve stays locked until the draft lands, or it would approve the old text under the new one.
  $('letter-approve').disabled = drafting || !text || (saved.state === 'approved' && saved.pdf && text === (saved.text || '').trim());
  draftSource?.changed();
}
function showLetter(status) {
  saved = {...status};
  $('letter-text').value = saved.text || '';
  if (saved.text) writing = false;
  paint();
}

// The kept letter shows at once; with none kept the skeleton stands in for the empty box, so "Not created" is never just an unread letter.
export async function loadLetter() {
  let painted = false;
  await swr('cover-letter', async () => ({ok: true, letter: await window.pilot.coverLetter()}), {
    loading: () => { reading(true, document, 'letter'); isReading = true; paint(); },
    paint: ({letter}, kept) => {
      if (!kept && painted && $('letter-text').value !== (saved.text || '')) return;   // a refresh never redraws a letter under edit
      reading(false, document, 'letter');
      isReading = false;
      painted = true;
      showLetter(letter);
    },
    fail: result => { reading(false, document, 'letter'); isReading = false; paint(); message('letter-message', result.error || 'Couldn\'t read your letter', 'error'); },
  });
}

// One action at a time: its buttons locked, the pressed one with the shared spinner (components.css button[aria-busy]). A draft (drafts) shows the shared
// AI-writing state over the kept letter (ai-writing.js) instead of a message; on failure the card is drawn again from the saved letter.
async function act(button, working, run, {drafts = false} = {}) {
  const all = ['letter-draft', 'letter-start-ai', 'letter-approve', 'letter-pdf'].map($).filter(Boolean);
  all.forEach(each => { each.disabled = true; });
  const pressed = drafts ? $('letter-draft') : button;   // a first draft is asked from the empty state, which the editor replaces at once
  pressed.setAttribute('aria-busy', 'true');
  const editor = $('letter-text'), feedback = $('letter-feedback');
  const wasReadOnly = editor.readOnly;
  let stop = () => {};
  let result;
  // Why (28 Oct 2026, code review): the writing state starts inside the try, so a throw there still reaches the finally and never leaves the card locked.
  try {
    if (drafts) {
      drafting = true;
      editor.readOnly = true;
      feedback.disabled = true;
      message('letter-message', '');   // the last action's line ("Approved ✓ …") is not true while a new draft is written
      paint();
      const first = !editor.value.trim();
      stop = aiWriting(editor, {title: first ? 'Writing your first draft' : 'Writing a new draft',
        note: first ? 'From your CV, Profile and writing preferences.' : 'Your current letter stays until the new one is ready.'});
    } else message('letter-message', working);
    result = await Promise.resolve().then(run).catch(error => ({ok: false, error: error.message}));
  } catch (error) { result = {ok: false, error: error.message}; }
  finally {
    pressed.removeAttribute('aria-busy');
    if (drafts) { stop(); drafting = false; editor.readOnly = wasReadOnly; feedback.disabled = false; }
    all.forEach(each => { each.disabled = false; });
  }
  if (result.ok) { showLetter(result); document.dispatchEvent(new Event('letter-updated')); } else paint();
  return result;
}

async function draft(button) {
  if (draftPending) return draftPending;
  const text = $('letter-text').value.trim();
  if (text && text !== (saved.text || '').trim() && !confirm('Replace the text you changed with a new draft?')) return;
  draftPending = (async () => {
    const result = await act(button, '', () => window.pilot.coverLetterDraft($('letter-feedback').value.trim()), {drafts: true});
    if (result.ok) $('letter-feedback').value = '';
    const used = result.ok ? usageAfter(result) : '';
    message('letter-message', result.ok ? `Here is a draft. Read it, change what you like, then approve.${used ? ` · ${used}` : ''}` : result.error, result.ok ? 'ok' : 'error');
    if (result.ok) hintAfter($('letter-message'), shared.state, openAi);   // Free AI wrote it: stronger writing with an own key
  })();
  try { return await draftPending; } finally { draftPending = null; }
}

export function initLetter({openAiSettings} = {}) {
  if (openAiSettings) openAi = openAiSettings;
  $('letter-text').addEventListener('input', buttons);
  $('letter-draft').addEventListener('click', () => draft($('letter-draft')));
  // Typed changes are a draft on Profile's one bar (Save all changes keeps it as a draft letter; Discard all puts the saved text back); Approve stays here.
  draftSource = profileBar().register({id: 'base-letter', tab: 'letter', label: 'Base letter', count: typedChange,
    save: async () => {
      const result = await window.pilot.coverLetterSave($('letter-text').value).catch(error => ({ok: false, error: error.message}));
      if (result.ok) { showLetter(result); document.dispatchEvent(new Event('letter-updated')); message('letter-message', 'Saved as a draft. Approve it to make the PDF.', 'ok'); }
      return result.ok ? {ok: true} : {ok: false, error: result.error};
    },
    discard: () => { $('letter-text').value = saved.text || ''; writing = false; paint(); },
    reveal: () => $('letter-text').focus()});
  $('letter-approve').addEventListener('click', async () => {
    const result = await act($('letter-approve'), 'Making the PDF…', () => window.pilot.coverLetterApprove($('letter-text').value));
    const words = 'Approved ✓ Used when a job has no usable tailored letter.';
    message('letter-message', result.ok ? words : result.error, result.ok ? 'ok' : 'error');
  });
  $('letter-pdf').addEventListener('click', () => window.pilot.coverLetterOpen());
}

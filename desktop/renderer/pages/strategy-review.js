// Setup step 3: the drafted strategy. The cards are the Strategy page's own (pages/setup-strategy.js moves them in and feeds them the draft); this file
// owns what only the setup has: the AI draft note, Regenerate draft and Replace my strategy. Guarded by test/setup-strategy.test.js.
import {ai} from '../ai-name.js';
import {costText, dollars} from '../ai-cost.js';
import {el, pill} from '../components.js';
import {shared} from './shared.js';
import {buildDraft, currentAnswers} from './activity.js';
import {$, message, osText, show} from './core.js';
import {loadJobs} from './jobs.js';
import {openView} from './nav.js';
import {openSetting} from './settings.js';
import {hideCards, showCards} from './setup-strategy.js';
import {toastMessage} from './startup.js';
import {goStep, saveState} from './wizard.js';
import {byStore} from '../store-words.js';
import {titleCase} from '../fragment-words.js';
export {titleCase};   // one place for it: renderer/fragment-words.js

// ---------- step 3: review the drafted strategy ----------
let draftSavedTimer, editsTimer;
export function draftChanged(fields) {
  clearTimeout(editsTimer);
  editsTimer = setTimeout(async () => {
    await window.pilot.cacheDraftEdits(Object.fromEntries(fields.map(field => [field, shared.draft[field]])));
    show($('draft-saved')); clearTimeout(draftSavedTimer);
    draftSavedTimer = setTimeout(() => show($('draft-saved'), false), 2500);
  }, 300);
}
// The note to the AI is one field (#q-more, what currentAnswers reads): a card on its own before building, folded
// under "Your note to the AI" in the review, next to Regenerate draft (which sends it too).
function placeNote(where) {
  if (where === 'intro') { $('draft-intro').querySelector('.step-card').append($('note-field')); return; }
  $('note-slot').append($('note-field'));
  noteSummary();
}
function noteSummary() {
  const note = currentAnswers().anything_else;
  $('note-summary').textContent = note ? note.replace(/\s+/g, ' ').slice(0, 80) + (note.length > 80 ? '…' : '') : 'none yet: add one, then Regenerate draft';
}
// Before a draft exists, after a failed one, or on Rebuild from CV: what the user wants, then Build my strategy.
export function showDraftIntro() {
  hideCards();
  placeNote('intro');
  show($('draft-intro')); show($('draft-actions'), false);
  show($('draft-loading'), false); show($('draft-view'), false); show($('draft-error'), false); show($('draft-stale'), false);
  $('draft-title').textContent = 'Your strategy'; show($('draft-subtitle'), false); show($('draft-cost'), false);
  $('goals-cost-text').textContent = ai(shared.state.settings.setupDone
    ? 'Rebuilding reads your CV and your note with {AI:main}: once. Nothing in your strategy changes until you review the result and pick what to apply.'
    : 'Building reads your CV and your note with {AI:main}: once. Nothing is saved until you review the result.');
}
export function renderDraft() {
  placeNote('review');
  show($('draft-intro'), false); show($('draft-actions'));
  show($('draft-loading'), false); show($('draft-error'), false); show($('draft-view'));
  $('draft-title').textContent = 'Review your strategy';
  show($('draft-subtitle'));
  const spent = costText(shared.draft.usd, usd => `✦ AI draft · ${dollars(usd)}`);   // only on the user's own API key (ai-cost.js)
  $('draft-cost').textContent = spent;
  show($('draft-cost'), !!spent);
  $('draft-summary').textContent = shared.draft.summary;
  $('draft-summary').title = 'Click to show all';
  showCards({changed: draftChanged});   // Main goals, Locations, Job preferences and Advanced search settings: the Strategy page's cards, reading the draft
  $('draft-save').disabled = false;
}
// The strategy step. No draft yet, a first setup whose CV changed since the draft, or Rebuild from CV: the note and
// Build my strategy (nothing is spent before that click). Otherwise the saved draft again (no new Claude call), with
// a Redraft bar when the CV or the note changed since; the user decides.
export async function toDraft() {
  const cached = await window.pilot.cachedDraft();
  const answersChanged = cached && (cached.answers?.anything_else || '') !== currentAnswers().anything_else;
  const stale = cached && (answersChanged || cached.cvChanged);
  if (!cached || shared.rebuildAsked || (cached.cvChanged && !shared.state.settings.setupDone)) { goStep('draft'); showDraftIntro(); return; }
  shared.draft = cached.draft;
  goStep('draft');
  renderDraft();
  $('draft-stale-text').textContent = cached.cvChanged ? 'Your CV changed since this strategy was drafted.'
    : answersChanged ? 'Your note changed since this strategy was drafted.' : '';
  show($('draft-stale'), !!stale);
}
async function saveDraft(parts = null) {
  for (const key of Object.keys(saveState)) delete saveState[key];
  document.querySelectorAll('#save-steps li').forEach(li => { li.className = ''; const count = li.querySelector('.count'); if (count) count.textContent = ''; });
  $('save-bar').style.width = '3%';
  $('save-title').textContent = byStore('Saving your strategy to Notion', 'Saving your strategy');
  message('save-message', '');
  show($('save-close'), false); show($('save-retry'), false);
  const replacing = !!shared.state.settings.setupDone;
  show(document.querySelector('[data-save-step="snapshot"]'), replacing);
  if (!replacing) saveState.snapshot = 1;  // nothing to keep on a first setup
  if (!$('save-dialog').open) $('save-dialog').showModal();
  const result = await window.pilot.saveStrategy(shared.draft, parts);
  if (!result.ok) {
    $('save-title').textContent = byStore('Not saved to Notion yet', 'Not saved yet');
    message('save-message', osText(`${result.error} Your strategy is kept on this computer: try again.`), 'error');
    show($('save-close')); show($('save-retry'));
    return;
  }
  $('save-title').textContent = byStore('Saved to Notion ✓', 'Saved ✓');
  $('save-bar').style.width = '100%';
  shared.state = await window.pilot.state();
  // A replaced strategy: back to the app; the first setup: on to the last step.
  setTimeout(() => {
    $('save-dialog').close();
    // The Strategy page read again: it still showed the strategy from before (7 Oct 2026: "Your Profile is empty" stayed after a rebuild filled it).
    if (replacing) { hideCards(); show($('wizard'), false); show($('app')); loadJobs(); import('./strategy.js').then(page => page.loadStrategy()); toastMessage('Strategy replaced ✓', byStore('The previous one is kept in Notion as “🗂 Previous strategy”.', 'The previous one is kept as “🗂 Previous strategy”.')); }
    else goStep('hosted');
  }, 900);
}
async function openRebuildReview() {
  $('rebuild-groups').replaceChildren(el('p', 'message waiting', 'Comparing the draft with your current strategy…'));
  $('rebuild-total').textContent = '';
  $('replace-go').disabled = true;
  $('replace-dialog').showModal();
  const current = shared.draft;
  $('rebuild-draft-cost').textContent = costText(shared.draft?.usd, usd => `This draft cost ${dollars(usd)} (already spent). `);
  const result = await window.pilot.rebuildImpact(current);
  if (!result.ok) { $('rebuild-groups').replaceChildren(el('p', 'message error', result.error)); return; }
  if (!result.groups.length) { $('rebuild-groups').replaceChildren(el('p', 'muted', 'This draft changes nothing in your current strategy.')); return; }
  const boxes = {};
  const update = () => {
    const picked = result.groups.filter(group => boxes[group.id].checked);
    $('replace-go').disabled = !picked.length;
    const uses = picked.some(group => group.cost === 'Uses AI');
    $('rebuild-total').textContent = picked.length ? `Applying ${picked.length} of ${result.groups.length}: ${uses ? 'AI re-scores the jobs over the next searches' : 'no AI re-scoring'}.` : 'Nothing selected.';
  };
  $('rebuild-groups').replaceChildren(...result.groups.map(group => {
    const box = el('label', 'review-group');
    box.dataset.group = group.id;
    const check = Object.assign(document.createElement('input'), {type: 'checkbox', checked: true});
    boxes[group.id] = check;
    const text = el('span', 'review-text');
    const head = el('span', 'review-head');
    head.append(el('b', '', group.title), pill(group.cost, group.cost === 'Uses AI' ? 'warn' : 'neutral'));
    const list = el('ul', 'review-changes');
    list.append(...group.changes.slice(0, 8).map(change => el('li', '', change)), ...(group.changes.length > 8 ? [el('li', 'muted', `+ ${group.changes.length - 8} more`)] : []));
    text.append(head, list, el('span', 'muted small', group.impact));
    if (group.linked) text.append(el('span', 'small review-linked', 'Locations and remote rules changed: applied to the search and the Profile together, so the crawl and the fit score agree.'));
    box.append(check, text);
    check.addEventListener('change', () => {
      if (group.linked && boxes[group.linked]) boxes[group.linked].checked = check.checked;  // one atomic change
      update();
    });
    return box;
  }));
  update();
}
// Every dialog: a click on the dimmed backdrop closes it like Esc (a dialog that blocks Esc, e.g. while saving,
// blocks this too). Pressed and released outside, so selecting text in a field and letting go outside doesn't close it.
let pressedOutside = null;
const outside = (dialog, event) => {
  const box = dialog.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
};
async function finishSetup() {
  hideCards();
  shared.state.settings = await window.pilot.saveSettings({setupDone: true});
  show($('wizard'), false); show($('app'));
  openView('jobs');
  loadJobs();
  // Jobs opens on the big Find jobs card (pages/jobs-find.js): the first search starts when the person presses it (owner, 24 Oct 2026).
  import('./missing-facts-open.js').then(page => page.openOnceAfterSetup()).catch(() => {});   // the most important missing fact, asked once (lib/missing-facts.js)
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('draft-summary').addEventListener('click', () => $('draft-summary').classList.toggle('open'));
  document.querySelectorAll('[data-goto-step]').forEach(button => button.addEventListener('click', () => goStep(button.dataset.gotoStep)));
  $('draft-redraft').addEventListener('click', () => { show($('draft-stale'), false); buildDraft(); });
  $('cv-next').addEventListener('click', toDraft);
  $('draft-again').addEventListener('click', buildDraft);
  $('draft-build').addEventListener('click', buildDraft);
  $('q-more').addEventListener('input', noteSummary);
  // First setup: save straight away. Setup done before (Rebuild from CV): review what changes, grouped by what each
  // change triggers (lib/strategy.js rebuildGroups), with the impact and AI cost; only the ticked groups are saved.
  $('draft-save').addEventListener('click', () => { if (shared.state.settings.setupDone) openRebuildReview(); else saveDraft(); });
  document.addEventListener('mousedown', event => {
    pressedOutside = event.target instanceof HTMLDialogElement && event.target.open && outside(event.target, event) ? event.target : null;
  });
  document.addEventListener('click', event => {
    const dialog = pressedOutside;
    pressedOutside = null;
    if (!dialog || event.target !== dialog || !outside(dialog, event)) return;
    if (dialog.dispatchEvent(new Event('cancel', {cancelable: true}))) dialog.close();
  });
  $('replace-cancel').addEventListener('click', () => $('replace-dialog').close());
  $('replace-go').addEventListener('click', event => {
    event.preventDefault();
    $('replace-dialog').close();
    saveDraft([...$('rebuild-groups').querySelectorAll('.review-group')].filter(row => row.querySelector('input').checked).map(row => row.dataset.group));
  });
  $('save-retry').addEventListener('click', saveDraft);
  $('save-close').addEventListener('click', () => $('save-dialog').close());
  $('save-dialog').addEventListener('cancel', event => { if (!$('save-close').hidden) return; event.preventDefault(); });  // no Esc while saving
  // "Set up" on the last step: finish the setup, open that Settings card, and offer the way back to the wizard.
  document.querySelectorAll('[data-goto-settings]').forEach(button => button.addEventListener('click', async () => {
    await finishSetup();
    openView('settings');
    show($('back-to-setup'));
    openSetting(button.dataset.gotoSettings);
  }));
  $('finish').addEventListener('click', finishSetup);
  $('back-to-setup-go').addEventListener('click', () => { show($('back-to-setup'), false); show($('app'), false); show($('wizard')); goStep('extras'); });
  $('back-to-setup-close').addEventListener('click', () => show($('back-to-setup'), false));
}

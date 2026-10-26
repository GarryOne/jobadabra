// Tune my strategy (Actions page): the changes your own results support (src/tune.py, no AI), each one ticked or not;
// only the ticked ones are written to ⚙️ Search settings (main.js tuneApply → lib/strategy.js retune).
import {withSaveProgress} from '../save-progress.js';
import {el} from '../components.js';
import {$, message, show} from './core.js';
import {applyLabel, basisParts, proposalCounts, proposalTitle} from '../tune-text.js';
import {toastMessage} from './startup.js';

// One proposal as a ticked row (the shared .check-row): what changes, then the counts it rests on.
export function proposalRow(item) {
  const li = el('li');
  const label = el('label', 'check-row');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = true;
  box.value = item.id;
  const words = el('span');
  words.append(el('b', '', proposalTitle(item)), el('span', 'muted', proposalCounts(item)));
  label.append(box, words);
  li.append(label);
  return li;
}

// The header under the title: a lead, then the counts it rests on (muted, its own line).
export function showBasis(answer) {
  const {lead, counts} = basisParts(answer);
  $('tune-basis').replaceChildren(lead, ...(counts ? [el('span', 'small muted', counts)] : []));
}
// Apply says how many ticked changes it writes, and is off with none ticked.
const countTicked = () => {
  const ticked = $('tune-list').querySelectorAll('input:checked').length;
  $('tune-apply').textContent = applyLabel(ticked);
  $('tune-apply').disabled = !ticked;
};

async function open() {
  $('tune-list').replaceChildren();
  for (const id of ['tune-apply', 'tune-cancel']) show($(id), false);
  message('tune-message', '');
  $('tune-basis').textContent = 'Reading your results…';
  if (!$('tune-dialog').open) $('tune-dialog').showModal();
  const answer = await window.pilot.tuneProposals();
  if (!answer?.ok) {
    $('tune-basis').textContent = '';
    message('tune-message', answer?.error || 'Could not read your results.', 'bad');
    return;
  }
  showBasis(answer);
  $('tune-list').replaceChildren(...answer.proposals.map(proposalRow));
  // No proposals: no Cancel or Apply, so the footer (its note about ticking) hides and × closes.
  for (const id of ['tune-apply', 'tune-cancel']) show($(id), answer.proposals.length > 0);
  countTicked();
}

async function apply() {
  const ids = [...$('tune-list').querySelectorAll('input:checked')].map(box => box.value);
  if (!ids.length) { message('tune-message', 'Tick at least one change, or close.', 'bad'); return; }
  $('tune-apply').disabled = true;
  const result = await withSaveProgress(words => message('tune-message', words, 'waiting'), () => window.pilot.tuneApply(ids)).catch(error => ({ok: false, error: error.message}));
  countTicked();
  if (!result?.ok) { message('tune-message', result?.error || 'Nothing changed. Try again.', 'bad'); return; }
  $('tune-dialog').close();
  toastMessage(`Strategy tuned: ${result.changed.length} change${result.changed.length === 1 ? '' : 's'}. The next search uses ${result.changed.length === 1 ? 'it' : 'them'}.`, '', {view: 'strategy'});
}

export function init() {
  $('tune-open').addEventListener('click', open);
  for (const id of ['tune-close', 'tune-cancel']) $(id).addEventListener('click', () => $('tune-dialog').close());
  $('tune-list').addEventListener('change', countTicked);
  $('tune-apply').addEventListener('click', apply);
}

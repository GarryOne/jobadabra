// Your details → "To check", the card at the top of the tab (owner, 28 Oct 2026: "this should be at the top in this tab… slightly better UI"). Three things can sit in it,
// each on its own: the details to review (the count and the one primary "Review" in the header), what the app concluded for the person (a notice row with Undo) and the values
// a pick set aside (one row each, with Undo). Nothing to show = the card is hidden. Drawn here, called by pages/details-facts.js. Guarded by test/details-to-check.test.js.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {showOnTab} from './tab-part.js';
import {setAsideRows} from './set-aside.js';

// The card's lead in index.html says what Review does; with nothing to review it says what else is here.
const LEAD_NONE = 'Nothing waits for you. What was changed on your behalf is listed here, with Undo.';
const $ = id => document.getElementById(id);

// One quiet row: an icon, the words (a line, then a muted one) and a solid Undo-style button at the right. Rows share dividers; never a box inside the card.
export function noteRow({words, detail = '', button = null, id = ''}) {
  const row = el('div', 'to-check-row'), text = el('div', 'to-check-words');
  if (id) row.dataset.setAside = id;
  text.append(el('span', '', words), ...(detail ? [el('span', 'muted small', detail)] : []));
  row.append(icon('info', 'icon'), text, ...(button ? [button] : []));
  return row;
}

// What the app concluded on open (lib/eligibility-settle.js, lib/details-kinds.js): said once, with the one Undo of the copy made before.
// Why (owner, 28 Oct 2026, "Save them automatically"): Work eligibility is concluded and saved on open, so its part of the notice says so.
export function tidiedRow(tidied, onUndo) {
  if (!tidied) return null;
  const eligibility = tidied.eligibility || 0, rest = tidied.changed - eligibility;
  const words = [rest ? `${rest} of your details were tidied: a typed control, or the rules folded as a note for the AI.` : '', eligibility ? 'Work eligibility was filled in from your earlier answers and saved.' : ''].filter(Boolean).join(' ');
  const undo = Object.assign(el('button', 'secondary small-btn with-icon', ''), {type: 'button'});
  undo.append(icon('undo', 'icon'), el('span', '', 'Undo'));
  undo.setAttribute('aria-label', 'Undo what was changed for you');
  undo.addEventListener('click', () => onUndo(undo));
  return noteRow({words, detail: 'The words you saved are kept, and the copy from before is backed up.', button: undo});
}

// state: {count, aside, tidied}; hooks: {onReview, onUndoTidy(button), onChange (reload after an Undo), showError(text)}.
export function drawToCheck({count = 0, aside = [], tidied = null}, {onReview, onUndoTidy, onChange, showError}, countLabel) {
  const card = $('setting-which');
  showOnTab($('setting-which'), count > 0 || aside.length > 0 || Boolean(tidied));
  if (!card) return;
  const lead = card.querySelector('.card-words p');
  if (lead) { lead.dataset.review ||= lead.textContent; lead.textContent = count > 0 ? lead.dataset.review : LEAD_NONE; }   // the review wording is kept to put back
  card.classList?.toggle('needs-you', count > 0);   // the thin warn edge: this card needs the person (colour marks, never fills)
  $('which-count')?.replaceChildren(...(count > 0 ? [pill(countLabel(count), 'warn')] : []));
  const review = Object.assign(el('button', 'primary small-btn', 'Review'), {type: 'button', id: 'details-review-go'});
  review.addEventListener('click', onReview);
  $('which-list').replaceChildren(...(count > 0 ? [review] : []));
  const notice = tidiedRow(tidied, onUndoTidy);
  $('facts-tidied').replaceChildren(...(notice ? [notice] : []));
  $('facts-set-aside').replaceChildren(...setAsideRows(aside, onChange, showError, {rows: noteRow}));
}

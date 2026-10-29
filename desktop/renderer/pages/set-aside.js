// "Set aside" under a Which-is-right card (owner, 17 Oct 2026: a pick never deletes the other value): each value a pick moved out of the way, with Undo
// (lib/set-aside.js). Shared by the Profile facts card and Strategy's Locations card. Guarded by test/set-aside-view.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';

// entries: the stored set-aside values; onChange: reload after an Undo; showError: where a failed Undo says why. -> the nodes to put in the card.
// rows: a card that draws its notices as rows (Your details → To check, pages/details-to-check.js noteRow) gets one row each with a solid Undo, no heading.
export function setAsideRows(entries, onChange, showError = () => {}, {rows: makeRow = null} = {}) {
  if (!entries?.length) return [];
  const press = (entry, undo) => async () => {
    undo.disabled = true;
    const result = await window.pilot.undoSetAside(entry.id).catch(error => ({ok: false, error: error.message}));
    if (result.ok) onChange(); else { showError(result.error || ''); undo.disabled = false; }
  };
  if (makeRow) return entries.map(entry => {
    const undo = Object.assign(el('button', 'secondary small-btn with-icon', ''), {type: 'button'});
    undo.append(icon('undo', 'icon'), el('span', '', 'Undo'));
    undo.setAttribute('aria-label', `Undo: put back ${entry.title} ${entry.value}`);
    undo.addEventListener('click', press(entry, undo));
    return makeRow({words: `${entry.title}: ${entry.value}`, detail: 'Set aside when you picked the other value. Kept, not deleted.', button: undo, id: entry.id});
  });
  const rows = entries.map(entry => {
    const row = el('div', 'chip-row');
    row.dataset.setAside = entry.id;
    const undo = Object.assign(el('button', 'link', 'Undo'), {type: 'button'});
    undo.setAttribute('aria-label', `Undo: put back ${entry.title} ${entry.value}`);
    undo.addEventListener('click', press(entry, undo));
    row.append(el('span', 'muted small', `${entry.title}: ${entry.value}`), undo);
    return row;
  });
  return [el('b', '', 'Set aside'), el('p', 'muted small', 'You picked the other value. These are kept; Undo puts one back.'), ...rows];
}

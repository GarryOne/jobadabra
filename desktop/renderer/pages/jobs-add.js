// Jobs "+ Add": one button and a small dialog of three choices; each row presses the opener of the flow that already exists (Add a job, Applied elsewhere, Log job activity).
// Guarded by: test/add-dialog.test.js.
import {$} from './core.js';

const rows = () => [...document.querySelectorAll('#add-dialog .add-choice')];

// Opens one flow: closes the choice dialog, then presses that flow's own opener.
export function openAddFlow(id) {
  $('add-dialog').close();
  $(id).click();
}

export function wireAdd() {
  const dialog = $('add-dialog');
  $('add-open').addEventListener('click', () => { dialog.showModal(); rows()[0]?.focus(); });
  rows().forEach(row => row.addEventListener('click', () => openAddFlow(row.dataset.add)));
  // Enter and click open a row (a button does both); the arrows move between rows; Esc closes (the dialog's own).
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const all = rows(), at = all.indexOf(document.activeElement);
    all[(at + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
    event.preventDefault();
  });
}

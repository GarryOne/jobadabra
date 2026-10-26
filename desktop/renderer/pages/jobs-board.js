// Jobs → Board: the applications in columns by Stage (the 🎯 Pipeline page's board in Notion), a card per job like the "In conversation"
// rows. Dragging a card to another column, or its ⋯ "Move to", asks the app for that stage (setStatus / setStage, jobs-board-rules.js
// dropFor), so the store's rules decide; the card stays where the store left it. Guarded by: test/jobs-board-page.test.js.
import {el, moreButton, pill} from '../components.js';
import {boardColumns, dropFor, STAGES, takesDrop} from '../jobs-board-rules.js';
import {matchLabel} from '../jobs-view.js';
import {$} from './core.js';
import {openJobPanel} from './job-panel.js';
import {toastMessage} from './startup.js';
import {jobsChanged} from './jobs.js';
import {openFromBoard} from './jobs-views.js';
import {jobPlace} from '../targets.js';

let dragged = null;   // the job being dragged (dataTransfer is unreadable during dragover)

export async function moveJob(job, stage) {
  const move = dropFor(job, stage);
  if (move.none) return;
  if (move.refused) { toastMessage('Not moved', move.refused, jobPlace(job)); return; }
  const before = job.stage;
  const result = await window.pilot[move.call](job.url, move.arg).catch(error => ({ok: false, error: error.message}));
  if (!result?.ok) { toastMessage('Not moved', result?.error || 'Try again.', jobPlace(job)); return; }
  // The store's answer is the truth: Saved or Dismissed never replace a real stage (rules.mark), so the card may stay.
  const landed = result.stage || (move.call === 'setStage' ? stage : before);
  if (landed === before) toastMessage('Kept', `${job.title || 'This job'} stays at ${before}: ${stage} never replaces an application stage.`, jobPlace(job));
  else toastMessage('Moved', `${job.title || 'This job'}: ${landed}.`, jobPlace(job));
  jobsChanged(job, {stage: landed});
  document.dispatchEvent(new CustomEvent('jobs-rerender'));
}

function card(job) {
  const item = Object.assign(el('li', 'focus-item board-card'), {tabIndex: 0, draggable: true, title: 'Drag to another stage, or click to open'});
  Object.assign(item.dataset, {code: job.code || '', url: job.url || ''});   // a pop-up's click finds it (pages/open-target.js focusJob)
  const body = el('div', 'focus-body');
  body.append(el('span', 'focus-headline', job.title || 'Role'), el('div', 'focus-meta muted small', job.company || ''));
  if (job.fit != null) body.append(el('div', 'muted small', `${job.fit} · ${matchLabel(job.fit)}`));   // a narrow column: one fact a line
  if (job.next_step) body.append(el('div', 'muted small', `Next: ${job.next_step}`));
  const moves = STAGES.filter(stage => stage !== job.stage && takesDrop(stage))
    .map(stage => ({label: stage, run: () => moveJob(job, stage)}));
  item.append(body, moreButton([{label: 'Move to', disabled: true}, ...moves], 'Move to another stage'));
  item.addEventListener('dragstart', event => { dragged = job; event.dataTransfer.setData('text/plain', job.url || ''); item.classList.add('is-dragging'); });
  item.addEventListener('dragend', () => { dragged = null; item.classList.remove('is-dragging'); });
  const open = event => { if (!event.target.closest('button, .ui-menu')) openFromBoard(() => openJobPanel(job)); };
  item.addEventListener('click', open);
  item.addEventListener('keydown', event => { if (event.key === 'Enter') open(event); });
  return item;
}

export function renderBoard(jobs) {
  const board = $('jobs-board');
  const columns = boardColumns(jobs);
  board.replaceChildren(...columns.map(column => {
    const box = el('section', `board-column${column.jobs.length ? '' : ' is-empty'}`);
    box.dataset.stage = column.stage;
    const head = el('header', 'board-column-head');
    head.append(pill(column.stage, column.tone, {dot: true}), el('span', 'muted small', String(column.jobs.length)));
    const list = el('ol', 'focus-list board-cards');
    list.append(...column.jobs.map(card));
    box.append(head, list);
    if (takesDrop(column.stage)) {
      box.addEventListener('dragover', event => { if (dragged && dragged.stage !== column.stage) { event.preventDefault(); box.classList.add('is-over'); } });
      box.addEventListener('dragleave', () => box.classList.remove('is-over'));
      box.addEventListener('drop', event => { event.preventDefault(); box.classList.remove('is-over'); if (dragged) moveJob(dragged, column.stage); });
    } else box.title = `${column.stage} is set by Jobadabra, not by moving a card`;
    return box;
  }));
  if (!jobs.length) board.prepend(el('p', 'empty board-empty', 'No applications here yet. Save, apply to or log a job and it shows on the board.'));
}

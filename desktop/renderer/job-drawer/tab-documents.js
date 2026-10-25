// Drawer → Documents: the job's tailored CV and its cover letter, each a card of label → value rows (Status, File, Actions). They used to sit
// inside Application → Preparation (owner, 18 Oct 2026: "New 'Documents' tab"). The CV opens in its window and saves as a file; the letter is
// the job's own (job-letter.js: copy, edit, write again) or, before one is made, the kit's. Nothing drafted: the state card with the action.
import {el, pill} from '../components.js';
import {wand} from '../magic.js';
import {stateCard} from './parts.js';
import {jobLetterView} from './job-letter.js';
import {docButton, docCard, docCopy, letterPanel, rows} from './documents-rows.js';

const tailor = (job, redraw) => async () => {
  const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`).catch(error => ({ok: false, error: error.message}));
  if (result.ok) { job.tailored = true; redraw(); return null; }
  return result.error || 'Try again.';
};

// Tailor CV + cover letter: the primary button of a card with nothing made yet, or of a failed one (the failure shows in the Status row).
function tailorButton(job, redraw, status, label = 'Tailor CV + cover letter') {
  const run = docButton(label, async () => {
    run.disabled = true; run.textContent = 'Tailoring… (1–2 min)';
    const error = await tailor(job, redraw)();
    if (error) { run.disabled = false; run.textContent = 'Try again'; status.replaceChildren(pill('Failed', 'bad'), ` ${error}`); }
  }, true);
  return wand(run);
}

function cvCard(job, files, redraw) {
  const pairs = [];
  if (!job.tailored) {
    if (!job.code) return docCard('Tailored CV', 'file', 'violet', rows([['Status', [pill('Not made', 'warn'), 'This job has no posting code to tailor from.']]]));
    const status = el('dd', 'doc-value');
    status.append(pill('Not made', 'warn'), ' It is made together with the cover letter.');
    return docCard('Tailored CV', 'file', 'violet', rowsWithStatus(status, tailorButton(job, redraw, status)));
  }
  const file = files[0];
  pairs.push(['Status', [pill('Ready', 'good'), 'Changes highlighted']]);
  if (file) pairs.push(['File', [el('span', 'attachment-name', file.name)]]);
  const actions = [];
  if (job.code) actions.push(docButton('Open', () => window.pilot.openTailoredCv(job.code), true));
  if (file?.url) {
    const save = docButton('Save as…', async () => { const done = await window.pilot.jobFileSave(file.name, file.url).catch(() => null); if (done?.ok) save.textContent = 'Saved ✓'; });
    actions.push(save);
  } else if (file) actions.push(el('span', 'muted small', 'Too large to save here'));
  pairs.push(['Actions', actions]);
  return docCard('Tailored CV', 'file', 'violet', rows(pairs));
}

// The status row and the button of a CV not made yet, in one grid: the status cell is rewritten when the tailoring fails.
function rowsWithStatus(status, action) {
  const list = rows([['Status', []], ['Actions', [action]]]);
  list.querySelector('dd').replaceWith(status);
  return list;
}

// The kit's own letter, when no tailored letter exists: read-only text with Copy.
function kitLetterCard(letter) {
  return docCard('Cover letter', 'mail', 'signal', rows([
    ['Status', [pill('Draft', 'neutral'), 'From your application kit']],
    ['Text', [letterPanel(letter)]],
    ['Actions', [docCopy(letter, 'Copy', true)]],
  ]));
}

export function documentsTab({job, parts}, redraw) {
  const kitLetter = parts.kit?.letter || '';
  const files = parts.documents || [];
  if (!job.tailored && !kitLetter && !files.length) {
    const status = el('span');
    const run = job.code ? tailorButton(job, redraw, status) : null;
    return [stateCard({icon: 'file', title: 'Not drafted yet', text: 'Apply drafts the kit, or Tailor CV + cover letter makes a CV and a letter for this job. They show here.', actions: run ? [run] : []})];
  }
  return [cvCard(job, files, redraw), job.tailored ? jobLetterView(job) : kitLetter ? kitLetterCard(kitLetter) : docCard('Cover letter', 'mail', 'signal', rows([['Status', [pill('Not written', 'warn'), 'Tailor CV + cover letter makes one with the CV.']]]))];
}

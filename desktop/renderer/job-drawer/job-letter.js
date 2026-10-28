// Documents → Cover letter: the job's own cover letter, made with its tailored CV: the text (copy, edit, write again) and its PDF (open).
// Filled from the app (IPC jobLetter); an edit remakes the PDF at once. One label → value row per fact (rows in documents-rows.js). Write again shows the
// shared AI-writing state over the kept letter (ai-writing.js). Guarded by test/job-letter.test.js, test/job-documents.test.js and test/ai-writing.test.js.
import {el, pill} from '../components.js';
import {aiWriting} from '../ai-writing.js';
import {docButton, docCard, docCopy, letterPanel, rows} from './documents-rows.js';

const FROM = {kit: 'From your application kit', ai: 'Written for this job', you: 'Edited by you'};

export function jobLetterView(job) {
  const key = job.code || job.url;
  const body = el('div', 'job-letter');
  const draw = async () => {
    const status = await window.pilot.jobLetter(key).catch(() => null);
    body.replaceChildren();
    if (!status?.text) { body.append(rows([['Status', [pill('Not written', 'warn'), 'Tailor CV + cover letter makes one with the CV.']]])); return; }
    const text = Object.assign(el('textarea', 'letter-text'), {value: status.text, rows: 12, hidden: true});
    const shown = letterPanel(status.text);
    const message = el('span', 'muted small', '');
    const edit = docButton('Edit', async () => {
      if (text.hidden) { text.hidden = false; shown.hidden = true; edit.textContent = 'Save'; return; }
      edit.textContent = 'Making the PDF…';
      const done = await window.pilot.jobLetterSave(key, text.value);
      if (done.ok) draw(); else { message.textContent = done.error; edit.textContent = 'Save'; }
    });
    // Why (28 Oct 2026, owner: the letter's loading state): the button alone said "Writing…" while the old letter looked like the answer.
    const again = docButton('Write again', async () => {
      const locked = [copy, edit, again, ...open];
      locked.forEach(button => { button.disabled = true; });
      again.setAttribute('aria-busy', 'true');
      again.textContent = 'Writing…';
      message.textContent = '';
      state.replaceWith(writingPill);
      let stop = () => {}, done;
      try {
        stop = aiWriting(text.hidden ? shown : text, {title: 'Writing a new letter for this job', note: 'The letter below stays until the new one is ready.'});
        done = await window.pilot.jobLetterAgain(key);
      } catch (error) { done = {ok: false, error: error.message}; }   // a throw before the call must still unlock the buttons (28 Oct 2026, code review)
      stop();
      writingPill.replaceWith(state);
      again.removeAttribute('aria-busy');
      locked.forEach(button => { button.disabled = false; });
      if (done.ok) draw(); else { message.textContent = done.error; again.textContent = 'Write again'; }
    });
    const open = status.pdf ? [docButton('Open PDF', () => window.pilot.jobLetterOpen(key))] : [];
    const copy = docCopy(status.text, 'Copy', true);
    const state = pill(status.pdf ? 'Ready' : 'Text only', status.pdf ? 'good' : 'neutral'), writingPill = pill('Writing…', 'info');
    body.append(rows([
      ['Status', [state, FROM[status.source] || '']],
      ...status.warnings.map(warning => ['Check', [el('span', 'muted', warning)]]),
      ['Text', [shown, text]],
      ['Actions', [copy, edit, again, ...open, message]],
    ]));
  };
  draw();
  return docCard('Cover letter', 'mail', 'signal', body);
}

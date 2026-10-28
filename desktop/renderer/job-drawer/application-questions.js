// Application → Preparation: this job's questions (owner, 17 Oct 2026), from the verdicts kept per question (lib/question-verdicts.js forJob):
// asked by this job only (a motivation essay, "why us"); asked by this employer only so far ("seen twice": it becomes a standard answer when a
// second employer asks); remembered on this job (it was the second: "✓ Remembered for future forms · Undo", Undo = only this job). Nothing shown
// when the job asked none. Guarded by test/question-lists.test.js and test/seen-twice.test.js.
import {el} from '../components.js';
import {group} from './parts.js';

const NOTE = {one_job: 'Asked by this job only', once: 'Asked once so far: kept as a standard answer when a second employer asks', remembered: '✓ Remembered for future forms'};

function row(item) {
  const line = el('div', 'iv-moment', item.question);
  const note = el('small', 'muted', NOTE[item.state] || '');
  line.append(note);
  // The answer kept for this job only (the review drawer's "Reuse for matching questions" off, until 28 Oct 2026): shown here, never offered on other forms.
  if (item.answer) line.append(el('small', 'job-answer', `Your answer: ${item.answer}`));
  if (item.state === 'remembered' && window.pilot?.jobQuestionOnly) {
    const undo = el('button', 'link', 'Undo');
    undo.title = 'Only this job: not kept as a standard answer';
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      const result = await window.pilot.jobQuestionOnly(item.question);
      if (result?.ok) note.replaceChildren('Only this job: not kept as a standard answer');
      else undo.disabled = false;
    });
    note.append(' · ', undo);
  }
  return line;
}

export function jobQuestionsView(job) {
  if (!job?.url || !window.pilot?.jobQuestions) return [];
  const box = group('📝 This job\'s questions', []);
  box.hidden = true;
  Promise.resolve(window.pilot.jobQuestions(job.url)).then(list => {
    if (!Array.isArray(list) || !list.length) return;
    box.append(...list.map(row));
    box.hidden = false;
  }).catch(() => {});
  return [box];
}

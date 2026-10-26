// Build a CV with the AI: the dialog behind "Build one with AI" (setup's CV step) and "Build with AI" (Settings → Profile → CV), plus its ⌘K entry.
// A short form -> the AI's draft (lib/cv-build.js) -> the person edits the words -> it becomes the main CV and its PDF. Facts stay as typed.
import {shared} from './shared.js';
import {$, message, show} from './core.js';
import {refreshCv} from './activity.js';
import {showCvChanged} from './cv-change.js';

const FIELDS = ['company', 'title', 'from', 'to', 'place', 'did'];
let draft = null;

const value = id => $(id).value.trim();
export function answers() {
  const jobs = [...document.querySelectorAll('#cvb-dialog .cvb-job')].map(box => Object.fromEntries(FIELDS.map(key => [key, box.querySelector(`[data-cvb="${key}"]`).value.trim()])))
    .filter(job => FIELDS.some(key => job[key]));
  return {name: value('cvb-name'), location: value('cvb-location'), targetRole: value('cvb-role'), years: value('cvb-years'), jobs, skills: value('cvb-skills'),
    languages: value('cvb-languages'), education: value('cvb-school') ? [{school: value('cvb-school'), degree: value('cvb-degree'), period: value('cvb-eduperiod')}] : []};
}

function showStep(step) {   // 'form' | 'draft' | 'saved'
  show($('cvb-form'), step === 'form'); show($('cvb-draft'), step !== 'form');
  show($('cvb-back'), step === 'draft'); show($('cvb-download'), step === 'saved'); show($('cvb-cancel'), step !== 'saved');
  $('cvb-go').hidden = false;
  $('cvb-go').textContent = step === 'form' ? 'Write my CV' : step === 'draft' ? 'Use this CV' : 'Done';
  $('cvb-title').textContent = step === 'form' ? 'Build your CV' : step === 'draft' ? 'Your draft' : 'Your CV is ready';
  $('cvb-lead').textContent = step === 'form' ? 'Answer what you can. The AI writes the wording; your employers, titles and dates stay exactly as you type them.'
    : step === 'draft' ? 'Change any words you like. Employers, titles and dates come from your answers.' : 'It is now your CV, saved on this Mac. Save the PDF to keep a copy.';
  message('cvb-message', '', '');
}

function renderDraft(cv) {
  $('cvb-summary').value = cv.summary || '';
  $('cvb-draft-skills').value = cv.skills || '';
  $('cvb-roles').replaceChildren(...cv.jobs.map((job, index) => {
    const role = job.roles[0], box = document.createElement('div');
    box.className = 'form-grid edit-aligned';
    const label = document.createElement('label'), area = document.createElement('textarea');
    label.append(`${role.title} · ${job.company}`, area);
    area.rows = 4; area.dataset.role = String(index); area.value = role.bullets.join('\n');
    box.append(label);
    return box;
  }));
}
const edited = () => ({...draft, ...(value('cvb-summary') ? {summary: value('cvb-summary')} : {summary: undefined}), skills: value('cvb-draft-skills') || undefined,
  jobs: draft.jobs.map((job, index) => ({...job, roles: [{...job.roles[0], bullets: $('cvb-roles').querySelector(`[data-role="${index}"]`).value.split('\n').map(l => l.trim()).filter(Boolean)}]}))});

export function openBuild() {
  draft = null;
  showStep('form');
  $('cvb-dialog').showModal();
}

export function init() {
  for (const id of ['cv-build', 'cv-build-profile']) $(id).addEventListener('click', openBuild);
  const close = () => $('cvb-dialog').close();
  $('cvb-close').addEventListener('click', close); $('cvb-cancel').addEventListener('click', close);
  $('cvb-back').addEventListener('click', () => showStep('form'));
  $('cvb-download').addEventListener('click', () => window.pilot.buildCvDownload());
  $('cvb-go').addEventListener('click', async () => {
    const button = $('cvb-go');
    if (button.textContent === 'Done') return close();
    button.disabled = true;
    try {
      if (!draft || !$('cvb-form').hidden) {
        message('cvb-message', 'Writing your CV…', 'waiting');
        const result = await window.pilot.buildCvDraft(answers());
        if (!result.ok) return message('cvb-message', result.error, 'error');
        draft = result.cv; renderDraft(draft); showStep('draft');
      } else {
        message('cvb-message', 'Saving your CV…', 'waiting');
        const result = await window.pilot.buildCvSave(edited());
        if (!result.ok) return message('cvb-message', result.error, 'error');
        shared.state = await window.pilot.state();
        refreshCv();
        $('contact-cv').textContent = result.name;
        if (shared.state.settings.setupDone) showCvChanged();
        showStep('saved');
      }
    } finally { button.disabled = false; }
  });
}

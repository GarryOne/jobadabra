// Jobs page, "Export" (Pro): saves the jobs on screen, or all of them, as a spreadsheet file. The lock here is only a hint: the main process checks the licence
// (lib/jobs-export-handlers.js). Free users see a locked button once Pro is on at the site, nothing while it is off. Guarded by: test/jobs-export.test.js.
import {el, openMenu} from '../components.js';
import {$, show} from './core.js';
import {shared} from './shared.js';
import {jobsState} from './jobs-state.js';
import {openSetting} from './settings.js';
import {toastMessage} from './startup.js';

const plural = n => `${n} job${n === 1 ? '' : 's'}`;
// licensed = a paid Pro account or an owner key; proMode = the site's Pro plan is on at all.
export const exportState = (state = {}) => (state.licensed ? 'open' : state.proMode ? 'locked' : 'hidden');

export async function exportJobs(options) {
  const answer = await window.pilot.exportJobs(options);
  if (answer?.pro) openSetting('plan');
  else if (answer?.ok) toastMessage(`Saved ${plural(answer.count)}`, answer.file);
  else if (answer?.error) toastMessage('Could not save the job list', answer.error);
}

export function renderExport() {
  const button = $('jobs-export'), mode = exportState(shared.licenseState || {});
  show(button, mode !== 'hidden');
  button.classList.toggle('is-locked', mode === 'locked');
  button.querySelector('.ui-pill')?.remove();
  if (mode === 'locked') button.append(' ', el('span', 'ui-pill tone-info', 'Pro'));
}

export function wireExport() {
  $('jobs-export').addEventListener('click', event => {
    if (exportState(shared.licenseState || {}) === 'locked') return openSetting('plan');
    const shown = jobsState.visible || [], all = shared.allJobs || [];
    openMenu(event.currentTarget, [
      {label: `These ${plural(shown.length)}`, detail: 'What the list shows now', disabled: !shown.length, run: () => exportJobs({urls: shown.map(job => job.url)})},
      {label: `All ${plural(all.length)}`, detail: 'Every job in your list', disabled: !all.length, run: () => exportJobs({all: true})},
    ]);
  });
}

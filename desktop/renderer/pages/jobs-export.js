// Jobs page, "Export" (Pro): saves the jobs on screen, or all of them, as a spreadsheet file. The lock here is only a hint: the main process checks the licence
// (lib/jobs-export-handlers.js). A free person always sees the button with a Pro label: with paying off it opens the Upgrade dialog, with paying on Settings → Plan (renderer/pro-gate.js).
// Guarded by: test/jobs-export.test.js, test/pro-gate.test.js.
import {el, openMenu} from '../components.js';
import {$, show} from './core.js';
import {shared} from './shared.js';
import {jobsState} from './jobs-state.js';
import {openProGate} from './pro-upgrade-dialog.js';
import {exportState} from '../pro-gate.js';
import {toastMessage} from './startup.js';
import {NO_PLACE} from '../targets.js';

const plural = n => `${n} job${n === 1 ? '' : 's'}`;
export {exportState};

export async function exportJobs(options) {
  const answer = await window.pilot.exportJobs(options);
  if (answer?.pro) openProGate();
  else if (answer?.ok) toastMessage(`Saved ${plural(answer.count)}`, answer.file, NO_PLACE.outside);
  else if (answer?.error) toastMessage('Could not save the job list', answer.error, {view: 'jobs'});
}

export function renderExport() {
  const button = $('jobs-export'), mode = exportState(shared.licenseState || {});
  show(button, true);
  button.classList.toggle('is-locked', mode === 'locked');
  button.querySelector('.ui-pill')?.remove();
  if (mode === 'locked') button.append(' ', el('span', 'ui-pill tone-info', 'Pro'));
}

export function wireExport() {
  $('jobs-export').addEventListener('click', event => {
    if (exportState(shared.licenseState || {}) === 'locked') return openProGate();
    const shown = jobsState.visible || [], all = shared.allJobs || [];
    openMenu(event.currentTarget, [
      {label: `These ${plural(shown.length)}`, detail: 'What the list shows now', disabled: !shown.length, run: () => exportJobs({urls: shown.map(job => job.url)})},
      {label: `All ${plural(all.length)}`, detail: 'Every job in your list', disabled: !all.length, run: () => exportJobs({all: true})},
    ]);
  });
}

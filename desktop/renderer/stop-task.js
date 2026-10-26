// Stop on a running task (owner, 7 Oct 2026: a search ran for an hour with no way to stop it): the Actions banner and Recent activity's
// detail both use this, so they look and behave alike. Shown only for a task this Mac can end (lib/pipeline.js stopTask).
import {toastMessage} from './pages/startup.js';

export function showStop(button, run) {
  const can = !!(run?.live !== false && run?.stoppable);
  button.hidden = !can;
  if (can && button.dataset.stopping !== '1') { button.disabled = false; button.textContent = 'Stop'; }
  if (!can) delete button.dataset.stopping;
}

export async function stopRunning(button) {
  button.dataset.stopping = '1';
  button.disabled = true;
  button.textContent = 'Stopping…';
  const result = await window.pilot.stopTask().catch(error => ({ok: false, error: error.message}));
  if (!result.ok) {
    delete button.dataset.stopping;
    button.disabled = false;
    button.textContent = 'Stop';
    toastMessage('Could not stop it', result.error || 'Try again.', {activity: true}, 'bad');
  }
}

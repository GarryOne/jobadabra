// "Look around first": the wizard's buttons that restart the app on the fictional demo data, and in that demo the
// banner with "Set up my own" (back to the user's own setup, where it was). Main process side: lib/demo.js.
import {shared} from './shared.js';
import {$, show} from './core.js';
import {plainError} from '../run-warnings.js';

export async function init() {
  document.querySelectorAll('[data-look-around]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Opening the demo…';
    const result = await window.pilot.lookAround(button.dataset.lookAround).catch(error => ({ok: false, error: error.message}));
    if (result?.ok === false) { button.disabled = false; button.textContent = plainError(result.error || 'The demo couldn\'t start'); }
  }));
  const lookingAround = !!shared.state.demo?.lookAround;
  show($('demo-banner'), lookingAround);
  document.body.classList.toggle('is-demo', lookingAround);
  if (!lookingAround) return;
  // Already in the demo: its wizard doesn't offer the demo again.
  document.querySelectorAll('[data-look-around]').forEach(button => show(button, false));
  $('demo-leave').addEventListener('click', () => {
    $('demo-leave').disabled = true;
    $('demo-leave').textContent = 'Restarting…';
    window.pilot.leaveDemo();
  });
}

// Why setup stopped: asked once when quitting mid-setup ("Leaving setup?"), or any time from "Stuck? Tell us" in the
// wizard. The reason goes to the setup funnel (lib/setup-funnel.js); typed words also reach the owner.
import {$} from './core.js';
import {toastMessage} from './startup.js';
import {NO_PLACE} from '../targets.js';

let mode = 'quit';

function open(asked) {
  mode = asked;
  const quit = mode === 'quit';
  $('why-title').textContent = quit ? 'Leaving setup? What stopped you?' : 'Stuck? What\'s in the way?';
  $('why-lead').textContent = quit ? 'One tap helps make setup easier for the next person. Optional.'
    : 'Tell us what\'s blocking you: it goes straight to the maker, and helps the next person too.';
  $('why-skip').textContent = quit ? 'Just quit' : 'Cancel';
  $('why-send').textContent = quit ? 'Send & quit' : 'Send';
  document.querySelectorAll('input[name=why]').forEach(input => { input.checked = false; });
  $('why-text').value = '';
  $('why-dialog').showModal();
}

async function answer(reason) {
  $('why-send').disabled = true;
  await window.pilot.leaveReason({reason, text: $('why-text').value, mode}).catch(() => {});
  $('why-send').disabled = false;
  $('why-dialog').close();
  if (mode === 'stuck' && reason) toastMessage('Thank you!', 'Got it. If you wrote something, the maker will read it today.', NO_PLACE.done);
}

export async function init() {
  window.pilot.onAskWhyLeaving(() => open('quit'));
  $('wizard-stuck').addEventListener('click', () => open('stuck'));
  $('why-send').addEventListener('click', () => answer(document.querySelector('input[name=why]:checked')?.value || (($('why-text').value.trim()) ? 'other' : '')));
  $('why-skip').addEventListener('click', () => answer(''));
  // Closing the dialog (Esc or ✕) while quitting still quits: the user asked to leave.
  $('why-dialog').addEventListener('cancel', () => { if (mode === 'quit') window.pilot.leaveReason({mode: 'quit'}); });
}

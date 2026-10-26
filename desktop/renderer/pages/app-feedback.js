// Send feedback (sidebar and Help → Send Feedback…): a short note to the owner (lib/app-feedback.js → the website →
// the owner's Telegram). The user's own words; a contact only if they type one.
import {$} from './core.js';
import {toastMessage} from './startup.js';
import {NO_PLACE} from '../targets.js';

function open() {
  $('app-feedback-message').textContent = '';
  $('app-feedback-dialog').showModal();
  $('app-feedback-text').focus();
}

export async function init() {
  $('nav-feedback').addEventListener('click', open);
  window.pilot.onOpenFeedback(open);
  $('app-feedback-send').addEventListener('click', async event => {
    event.preventDefault();
    const button = $('app-feedback-send');
    button.disabled = true;
    $('app-feedback-message').textContent = 'Sending…';
    const result = await window.pilot.sendFeedback($('app-feedback-text').value, $('app-feedback-contact').value)
      .catch(error => ({ok: false, error: error.message}));
    button.disabled = false;
    if (!result?.ok) { $('app-feedback-message').textContent = result?.error || 'Couldn\'t send it.'; return; }
    $('app-feedback-text').value = '';
    $('app-feedback-dialog').close();
    toastMessage('Thank you!', 'Your feedback went straight to the maker. If you left a contact, expect a reply.', NO_PLACE.done, 'good');
  });
}

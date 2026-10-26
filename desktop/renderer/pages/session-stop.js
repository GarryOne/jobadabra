// The Stop button of the sessions page (owner, 13 Oct 2026: "a stop button, in case the extension goes wrong"): one press asks the extension to stop everything it does, on every tab (no press, no typing,
// the debugger detached) and the live applications say "Stopped" at once; Reopen form on a card is the person's own start again. The same entry is in ⌘K (nav.js); the extension has its own on
// the toolbar popup and on the application's page, and Chrome's "Cancel" on its debugging bar stops it too. Guard: test/stop-request.test.js, test/palette-stop.test.js.
import {$} from './core.js';
import {refreshSessions} from './sessions.js';
import {toastMessage} from './startup.js';

export function init() {
  $('ss-stop').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.pilot.sessionsStopExtension();
      toastMessage(result?.ok === false ? 'Could not stop' : 'Stopped', result?.ok === false ? (result.error || 'Turn the extension off in chrome://extensions.')
        : 'The extension is told to stop everything, on every tab. It does nothing until you press Reopen form on an application.', {view: 'sessions'});
      await refreshSessions();
    } finally { button.disabled = false; }
  });
}

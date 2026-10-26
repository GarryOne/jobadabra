// The one Chrome switch line on Focus (owner, 21 Oct 2026: make the real-tab step run for users): when sites that refused Jobadabra wait for "Allow in Incognito", one line above Up next
// says how many and opens the extension's Chrome page. A strip of its own (focus.js is near its size limit); the app sets refusedIncognitoWaiting (lib/refused-reads.js). Guard: test/focus-incognito.test.js.
import {el} from '../components.js';
import {$} from './core.js';
import {waitingOf, lineOf} from './incognito-rows.js';

// The extension's one-minute look opens its own Chrome details page (lib/refused-reads.js takeOpenSwitch). Moved here from the removed Settings card (26 Oct 2026).
export const openSwitch = () => window.pilot.saveSettings({refusedOpenSwitch: true});
let strip = null;
async function paint() {
  const count = waitingOf((await window.pilot.state().catch(() => null))?.settings), anchor = $('focus-up-title')?.closest('section');
  if (!count || !anchor) { strip?.remove(); strip = null; return; }
  strip?.remove();
  strip = el('section', 'card ready-focus');
  const open = el('button', 'secondary', "Open Chrome's switch");
  open.addEventListener('click', async () => { await openSwitch(); open.textContent = 'Opening in Chrome in a moment…'; open.disabled = true; });
  const words = el('span', '', '');
  words.append(el('b', '', lineOf(count)), ' · ', el('span', 'muted', 'Turn on “Allow in Incognito” for the extension, then come back.'));
  strip.append(words, open);
  anchor.before(strip);
}
export function initFocusIncognito() { paint(); window.addEventListener('activity-updated', paint); }

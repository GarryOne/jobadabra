// The window says which build runs (owner, 16 Oct 2026: the app ran a build older than the merged fixes and he tested old code without knowing): the commit and its time under the menu (a package: its version and a "What's new" link to the changelog),
// and, when the checkout has gained desktop/extension commits since the app started, "Restart to get N fixes" (a source run; a package gets its fixes through the Update button, pages/update.js).
// The state comes from main (lib/build-handlers.js); it is asked again every minute and when the window gets focus. Its command is in ⌘K (pages/nav.js).
import {$, show} from './core.js';
import {toastMessage} from './startup.js';
import {NO_PLACE} from '../targets.js';

let state = {ahead: 0, label: '', restart: ''};

async function restart() {
  const button = $('nav-restart');
  button.disabled = true;
  $('nav-restart-text').textContent = 'Restarting…';
  const result = await window.pilot.restartApp().catch(error => ({ok: false, text: error.message}));
  if (result.ok) return;   // the app quits and opens again on the new code
  button.disabled = false;
  $('nav-restart-text').textContent = state.restart;
  toastMessage("Couldn't restart", result.text || 'Quit the app and open it again.', NO_PLACE.app, 'bad');
}

function paint(next) {
  state = next || state;
  $('build-text').textContent = state.label ? `${state.label}${state.whatsNew ? ' · ' : ''}` : '';
  show($('build-news'), !!state.whatsNew);   // a package: "v0.7.0 · What's new" opens the website's changelog
  $('build-line').title = state.label ? `This window runs the build ${state.label}` : '';
  show($('build-line'), !!state.label);
  $('nav-restart-text').textContent = state.restart;
  $('nav-restart').title = state.ahead ? `The app on this Mac was updated: ${state.ahead} change${state.ahead === 1 ? '' : 's'} to the app or the extension are not running yet` : '';
  show($('nav-restart'), state.ahead > 0);
}

// ⌘K: the same action as the button, only while there is something to restart for.
export const buildCommands = () => (state.ahead > 0 ? [{group: 'App', label: state.restart, hint: 'Open the app again so it runs the latest code', keywords: 'restart relaunch reload update fixes build new version', run: restart}] : []);

export async function init() {
  const ask = () => window.pilot.buildState().then(paint).catch(() => {});
  $('nav-restart').addEventListener('click', restart);
  $('build-news').addEventListener('click', () => state.whatsNew && window.pilot.openExternal(state.whatsNew));
  await ask();
  setInterval(ask, 60 * 1000);
  window.addEventListener('focus', ask);
}

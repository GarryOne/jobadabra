// Apply with Claude prerequisites: what only the user can install, shown in Settings when Claude help is available.
import {resumeOffered} from '../claude-help.js';
import {icon} from '../icons.js';

export async function showClaudePrereqs() {
  const inSettings = document.getElementById('claude-prereqs-settings');
  if (inSettings) inSettings.hidden = !resumeOffered();
  if (!resumeOffered()) return;   // nothing to check while Claude help is off
  const found = await window.pilot.claudePrereqs().catch(() => null);
  if (!found) return;
  const link = (href, text) => Object.assign(document.createElement('a'), {href, target: '_blank', textContent: text});
  const items = [
    [found.claude, 'Claude Code installed', link('https://claude.com/claude-code', 'Install Claude Code')],
    [found.signedIn, 'Signed in to Claude Code with your Claude account', document.createTextNode(
      found.windows ? 'Open PowerShell, run claude, then /login' : 'Open Terminal, run claude, then /login')],
    ...(found.windows ? [[found.git, 'Git for Windows installed (Claude Code needs it)', link('https://git-scm.com/downloads/win', 'Install Git for Windows')]] : []),
    [found.chrome, found.chrome ? 'Claude in Chrome extension added (sign in to it in Chrome once)' : 'Claude in Chrome extension added and signed in',
      link('https://chromewebstore.google.com/search/Claude', 'Get it from the Chrome Web Store')],
    // Built into the app (nothing to install): sessions run inside Jobadabra; without it, in Terminal windows.
    [found.inApp, found.inApp ? 'In-app terminal ready (built in): sessions run inside Jobadabra' : 'In-app terminal unavailable',
      document.createTextNode('sessions open in Terminal windows instead')],
  ];
  const draw = () => items.map(([done, text, action]) => {
    const li = document.createElement('li');
    li.className = done ? 'done' : '';
    const words = document.createElement('span');
    words.append(text);
    if (!done) words.append(' · ', action.cloneNode(true));
    li.append(icon(done ? 'check-circle' : 'info'), words);
    return li;
  });
  if (inSettings) inSettings.replaceChildren(...draw());
}
window.addEventListener('claude-help', () => showClaudePrereqs());   // the switch turned on in Settings: what to install shows under it at once

// A windowless Chrome from an earlier automation holds macOS's one Apple Event connection to Chrome, so the app

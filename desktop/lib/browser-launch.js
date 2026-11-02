// Which Chromium browser to open a URL in, and how. Chrome first (what the app always did), then Edge (the Windows
// default, same extension API), Brave, Vivaldi. `prefer` is the browser the Jobadabra extension is installed in:
// a form opened anywhere else would never be filled.
import fs from 'node:fs';
import path from 'node:path';
import {hiddenRun} from './e2e-hidden.js';
import {lastUsedProfile} from './browser-profile.js';

// scheme: how that browser spells its own pages (chrome://extensions, edge://extensions).
// win: the folder below Program Files / Program Files (x86) / %LOCALAPPDATA% where the installer puts the exe.
export const LAUNCH = [
  {app: 'Google Chrome', scheme: 'chrome', win: ['Google', 'Chrome', 'Application', 'chrome.exe']},
  {app: 'Microsoft Edge', scheme: 'edge', win: ['Microsoft', 'Edge', 'Application', 'msedge.exe']},
  {app: 'Brave Browser', scheme: 'brave', win: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']},
  {app: 'Vivaldi', scheme: 'vivaldi', win: ['Vivaldi', 'Application', 'vivaldi.exe']},
];

const find = app => LAUNCH.find(browser => browser.app === app);
export const schemeOf = app => (find(app) || LAUNCH[0]).scheme;

// `open -a` on the Mac; on Windows the exe itself (no shell, so a URL's & stays part of the URL), from where the
// installer puts it. null on Windows when none is installed. On the Mac a browser counts as installed when its .app is
// in /Applications or ~/Applications; with none found it still says Chrome, as before, and `open` explains.
// Returns [command, args, app] ... callers spread the first two.
export function browserCommand(urls, platform = process.platform, env = process.env, exists = fs.existsSync, prefer = '', read = fs.readFileSync) {
  // The end-to-end journey on Windows: no `open` to put a stand-in for on PATH, so node runs its stand-in script (never for a user: needs JOBADABRA_E2E).
  if (env.JOBADABRA_E2E && env.JOBADABRA_E2E_OPENER) return ['node', [env.JOBADABRA_E2E_OPENER, ...urls]];
  const order = [find(prefer), ...LAUNCH].filter(Boolean).filter((browser, i, all) => all.indexOf(browser) === i);
  if (platform !== 'win32') {
    const home = env.HOME || '';
    const there = browser => [`/Applications/${browser.app}.app`, home && path.join(home, 'Applications', `${browser.app}.app`)]
      .filter(Boolean).some(file => exists(file));
    const browser = order.find(there) || LAUNCH[0];
    const profile = lastUsedProfile(browser.app, platform, env, read);   // no flag = the browser may ask "who is using Chrome?" and lose the URL
    return ['open', [...(hiddenRun(env) ? ['-g'] : []), '-a', browser.app, ...urls, ...(profile ? ['--args', `--profile-directory=${profile}`] : [])]];   // -g: an e2e run opens tabs in the background
  }
  for (const browser of order) {
    const exe = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean)
      .map(dir => path.win32.join(dir, ...browser.win)).find(file => exists(file));
    if (exe) { const profile = lastUsedProfile(browser.app, platform, env, read); return [exe, [...(profile ? [`--profile-directory=${profile}`] : []), ...urls]]; }
  }
  return null;
}

// The browser a command would open (for the scheme of its own pages): the app name, or '' when unknown.
export function browserOf(command) {
  const [bin, args = []] = command || [];
  if (bin === 'open') return args[args.indexOf('-a') + 1] || '';
  const name = String(bin || '').split(/[\\/]/).pop().toLowerCase();
  return LAUNCH.find(browser => browser.win[browser.win.length - 1] === name)?.app || '';
}

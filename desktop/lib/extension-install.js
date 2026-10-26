// Is the Jobadabra extension loaded in a Chromium browser on this computer — and is it awake?
//
// The extension reports in every 30 s (extension/background.js) and that report is the only proof it is really
// running: it is what lets the app fill a form right now. But "no report" is not "not installed" — the browser may
// be closed, or the extension may simply be between alarms. The browser itself recorded the answer in its profile,
// so read that: a file read tells installed / turned off / open Chrome apart at once, instead of the app showing
// "Checking…" for a minute and then guessing (1 Oct 2026).
//
// The Mac and the PC keep those profiles, and their browsers, in different places; both are read here.
import {browserData} from './browser-profile.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {browserCommand, schemeOf} from './browser-launch.js';

// The name in extension/manifest.json: how the extension is recognised whatever folder it was loaded from.
export const NAME = 'Jobadabra';   // the extension's name in Chrome; an install from before the rename is still called 'Job Pilotto' (line 78)

// Chromium-family browsers that keep their extension records in <support>/<dir>/<Profile>/Secure Preferences.
// `dir` is the Mac layout; `win` the PC's, which repeats the browser's own folder under a "User Data" one.
//
// Every PC layout below was checked against the browser's own documentation on 1 Oct 2026, because nobody here can
// look at a PC:
//   Chrome, Chrome Canary, Chromium  Chromium's docs: %LOCALAPPDATA%\Google\Chrome\User Data,
//                                    %LOCALAPPDATA%\Google\Chrome SxS\User Data (the canary channel's install
//                                    suffix), %LOCALAPPDATA%\Chromium\User Data
//                                    https://chromium.googlesource.com/chromium/src/+/main/docs/user_data_dir.md
//   Brave                            %userprofile%\AppData\Local\BraveSoftware\Brave-Browser\User Data
//                                    https://support.brave.app/hc/en-us/articles/29808985123085
//   Microsoft Edge                   …\AppData\Local\Microsoft\Edge\User Data (edge://version shows it)
//                                    https://learn.microsoft.com/en-us/deployedge/edge-learnmore-create-user-directory-vars
//   Vivaldi                          …\AppData\Local\Vivaldi\User Data (vivaldi://about shows it)
//                                    https://help.vivaldi.com/desktop/privacy/preventing-vivaldi-profiles-from-being-uploaded-to-git-repositories/
//
// A browser that isn't in this list, or one started with --user-data-dir, keeps its profile somewhere this can't
// know: on a PC, chrome://version (edge://version, brave://version) names the real Profile Path and its parent.
export const BROWSERS = [
  {name: 'Google Chrome', dir: 'Google/Chrome', win: 'Google/Chrome/User Data', app: 'Google Chrome'},
  {name: 'Google Chrome Canary', dir: 'Google/Chrome Canary', win: 'Google/Chrome SxS/User Data', app: 'Google Chrome Canary'},
  {name: 'Chromium', dir: 'Chromium', win: 'Chromium/User Data', app: 'Chromium'},
  {name: 'Brave', dir: 'BraveSoftware/Brave-Browser', win: 'BraveSoftware/Brave-Browser/User Data', app: 'Brave Browser'},
  {name: 'Microsoft Edge', dir: 'Microsoft Edge', win: 'Microsoft/Edge/User Data', app: 'Microsoft Edge'},
  {name: 'Vivaldi', dir: 'Vivaldi', win: 'Vivaldi/User Data', app: 'Vivaldi'},
];

export const browserDir = (browser, platform = process.platform) =>
  (platform === 'win32' ? browser.win || browser.dir : browser.dir);

// Where those browsers keep their profiles: the Mac's Application Support, or the PC's %LOCALAPPDATA%.
export const support = (platform = process.platform, env = process.env) => browserData(platform, {HOME: os.homedir(), ...env}, os.homedir());
// Chrome's profile folders, without listing the browser's directory (a demo or test fixture only makes the ones it uses).
const profiles = () => ['Default', ...Array.from({length: 12}, (_, i) => `Profile ${i + 1}`)];
const parse = (file, read) => { try { return JSON.parse(read(file, 'utf8')); } catch { return null; } };

const real = at => { try { return fs.realpathSync(at); } catch { return path.resolve(at); } };

// The Jobadabra records in one browser profile set: {id, profile, version, folder, enabled, unpacked} each.
// Secure Preferences first (that is where Chrome keeps extension settings now); Preferences for older browsers.
//
// Two shapes, and both matter: an extension from the Web Store (or one with a manifest "key") is recorded with its
// manifest — name and version — while an *unpacked* one is recorded as `location: 4` with only its PATH, no manifest
// at all. Matching on the name alone therefore missed the ordinary "Load unpacked" install that was sitting right
// there, and the app kept telling its owner to install what was already installed (1 Oct 2026).
export function inProfile(root, {read = fs.readFileSync, exists = fs.existsSync, list = profiles, folder = '',
  platform = process.platform} = {}) {
  const p = platform === 'win32' ? path.win32 : path;  // the joins are the platform's, not this machine's
  const ours = folder ? real(folder) : '';
  const found = [];
  for (const profile of list()) {
    for (const file of ['Secure Preferences', 'Preferences']) {
      const at = p.join(root, profile, file);
      if (!exists(at)) continue;
      const settings = parse(at, read)?.extensions?.settings;
      if (!settings) continue;
      for (const [id, entry] of Object.entries(settings)) {
        const named = [NAME, 'Job Pilotto'].includes(entry?.manifest?.name);
        const byPath = entry?.location === 4 && !!ours && !!entry.path && real(entry.path) === ours;
        if (!named && !byPath) continue;
        found.push({id, profile, version: entry.manifest?.version || '', folder: entry.path || '',
          enabled: !(entry.disable_reasons || []).length, unpacked: entry.location === 4});
      }
    }
  }
  return found;
}

// Where this computer is looked in, in the order it is looked in: the browser, the folder that would hold its
// profiles, and whether that folder is there at all. Settings → Connections shows it, so a machine whose extension
// isn't found can compare this list with the browser's own Profile Path (chrome://version, edge://version,
// brave://version) — which is the only way to find out where a browser this list doesn't know, or one started with
// --user-data-dir, has put it.
export function lookedFor({support: root = '', browsers = BROWSERS, exists = fs.existsSync,
  platform = process.platform, env = process.env} = {}) {
  const p = platform === 'win32' ? path.win32 : path;
  const base = root || support(platform, env);
  return browsers.map(browser => {
    const dir = browserDir(browser, platform);
    return {browser: browser.name, dir, at: p.join(base, dir), there: !!exists(p.join(base, dir))};
  });
}

// Every browser on this computer that has it. `current` marks the copy loaded from the app's own folder (in
// development <repo>/extension, packaged the app's resources): another copy is one the user made, and it stays
// behind when the app updates its own.
export function installed({folder = '', support: root = '', browsers = BROWSERS, read = fs.readFileSync,
  exists = fs.existsSync, platform = process.platform, env = process.env} = {}) {
  const ours = folder ? real(folder) : '';
  const base = root || support(platform, env);
  const p = platform === 'win32' ? path.win32 : path;
  const out = [];
  for (const browser of browsers) {
    const dir = p.join(base, browserDir(browser, platform));
    if (!exists(dir)) continue;
    for (const entry of inProfile(dir, {read, exists, folder, platform})) {
      out.push({browser: browser.name, app: browser.app, ...entry, current: !!ours && !!entry.folder && real(entry.folder) === ours});
    }
  }
  return out;
}

// The browser's own process name on Windows — Task Manager's name for it — where there is no pgrep. These are the
// conventional image names, not something a vendor documents, which is why the test insists every browser in
// BROWSERS has one: the `${app}.exe` fallback below would ask tasklist for "Microsoft Edge.exe" and be told, wrongly,
// that nothing is running.
export const PROCESS = {'Google Chrome': 'chrome.exe', 'Google Chrome Canary': 'chrome.exe', Chromium: 'chromium.exe',
  'Brave Browser': 'brave.exe', 'Microsoft Edge': 'msedge.exe', Vivaldi: 'vivaldi.exe'};

// Is that browser up? pgrep on the Mac, tasklist on Windows — neither needs any automation permission, and either
// is what tells "open Chrome" from "waiting for its next report".
export function running(app, {exec = execFile, platform = process.platform} = {}) {
  if (platform !== 'win32') return new Promise(resolve => exec('/usr/bin/pgrep', ['-x', app], error => resolve(!error)));
  const image = PROCESS[app] || `${app}.exe`;
  return new Promise(resolve => exec('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'],
    (error, stdout) => resolve(!error && String(stdout || '').includes(image))));
}

// Chrome names an extension after its public key when its manifest pins one ("key", as this repo's does: the ID
// must not change with the folder), and after the absolute path it was loaded from otherwise. Either way the name is
// sha256 of those bytes, its first 128 bits, each nibble as a-p — so the app can open its own extension's pages
// (options, popup) with no browser help.
export function extensionId(folder, {read = fs.readFileSync} = {}) {
  let seed = path.resolve(String(folder));
  try {
    const key = JSON.parse(read(path.join(seed, 'manifest.json'), 'utf8'))?.key;
    if (key) seed = Buffer.from(key, 'base64');
  } catch { /* no manifest to read: the folder path is the seed, as Chrome would use */ }
  const hex = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return [...hex].map(nibble => String.fromCharCode(97 + parseInt(nibble, 16))).join('');
}

// Open a URL in a Chromium browser itself (the default browser may not be one, and chrome:// / edge:// pages only exist in
// their own browser). `browser` is the app name to use (the one the extension is in); otherwise Chrome, then Edge. The
// launcher is the app's one: `open -a` on the Mac, the browser's exe on Windows.
export function openInChrome(url, {exec = execFile, platform = process.platform, env = process.env, exists = fs.existsSync, browser = ''} = {}) {
  const command = browserCommand([url], platform, env, exists, browser);
  if (!command) return Promise.resolve(false);  // no supported browser installed: nothing to open it with
  return new Promise(resolve => exec(command[0], command[1], error => resolve(!error)));
}

// The extension's Chrome Web Store page: the install every user gets (owner, 26 Oct 2026). Edge and Brave install from it too.
export const STORE_URL = 'https://chromewebstore.google.com/detail/jobadabra/nmbnjhmpofifgcdalfefddbiihccogoi';
export const openStorePage = (options = {}) => openInChrome(STORE_URL, options);

// A browser's own extensions page: chrome://extensions, edge://extensions…
export const extensionsUrl = browser => `${schemeOf(browser)}://extensions`;

// The two pages the install flow needs: the browser's own extensions list, and the extension's options page, whose
// "Connect to the Jobadabra app" is what makes it start reporting.
export const openExtensionsPage = (options = {}) => openInChrome(extensionsUrl(options.browser), options);
export const openOptionsPage = (folder, options = {}) => openInChrome(`chrome-extension://${extensionId(folder)}/options.html`, options);

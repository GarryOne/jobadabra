// Jobadabra's browser: Chrome for Testing (full Chromium; the headless shell cannot load the extension), downloaded into the app folder on first use
// with progress and Cancel, never bundled or system-wide. Guard: test/background-browser-download.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {optionalAddon} from './optional-addon.js';
const INDEX = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
const PLATFORM = {'darwin-arm64': 'mac-arm64', 'darwin-x64': 'mac-x64', 'win32-x64': 'win64', 'linux-x64': 'linux64'};
const executableOf = (dir, platform) => path.join(dir, `chrome-${platform}`, ...(platform.startsWith('mac-') ? ['Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'] : [platform.startsWith('win') ? 'chrome.exe' : 'chrome']));
const runFile = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, {windowsHide: true, timeout: 120000}, error => error ? reject(error) : resolve()));

/** Find only the optional runtime in the app's own folder; system profiles/browsers are never inspected. */
export function findBackgroundBrowser(dir, {key = `${process.platform}-${process.arch}`, exists = fs.existsSync} = {}) {
  const platform = PLATFORM[key], file = platform && executableOf(dir, platform);
  return file && exists(file) ? file : null;
}
/** Download Chrome for Testing after an explicit user action; report progress and leave the old runtime intact on failure/cancel. */
export function installBackgroundBrowser(dir, {key = `${process.platform}-${process.arch}`, fetchImpl = globalThis.fetch, onProgress = () => {}, signal, run = runFile, work = os.tmpdir()} = {}) {
  // One download at a time is the add-on's (lib/optional-addon.js), not this function's.
  return (async () => {
    const platform = PLATFORM[key];
    if (!platform) throw new Error('Background browser is not available for this processor yet.');
    onProgress({step: 'checking'});
    const index = await fetchImpl(INDEX, {signal});
    if (!index.ok) throw new Error('The background browser download list is unavailable.');
    const build = (await index.json()).channels?.Stable?.downloads?.chrome?.find(item => item.platform === platform);
    const url = new URL(build?.url || 'https://invalid.invalid');
    if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' || !url.pathname.startsWith('/chrome-for-testing-public/')) throw new Error('The browser download address could not be verified.');
    const temp = fs.mkdtempSync(path.join(work, 'jp-background-browser-')), file = path.join(temp, 'browser.zip'), next = `${dir}.new`;
    try {
      const response = await fetchImpl(url.href, {signal});
      if (!response.ok || !response.body) throw new Error('The browser could not be downloaded.');
      const total = Number(response.headers.get('content-length')) || 0;
      const expected = /(?:^|,)\s*md5=([^,]+)/.exec(response.headers.get('x-goog-hash') || '')?.[1];
      if (!expected) throw new Error('The browser download has no integrity digest.');
      const hash = createHash('md5'), out = fs.createWriteStream(file);
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          signal?.throwIfAborted(); hash.update(chunk); bytes += chunk.length;
          if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
          onProgress({step: 'download', bytes, total, share: total ? bytes / total : null});
        }
      } finally { await new Promise(resolve => out.end(resolve)); }
      if (hash.digest('base64') !== expected || (total && bytes !== total)) throw new Error('The browser download did not match its integrity digest.');
      signal?.throwIfAborted(); onProgress({step: 'unpack'});
      fs.rmSync(next, {recursive: true, force: true}); fs.mkdirSync(next, {recursive: true});
      if (key.startsWith('darwin')) await run('ditto', ['-x', '-k', file, next]);
      else if (key.startsWith('win32')) await run('tar', ['-xf', file, '-C', next]);
      else await run('unzip', ['-q', file, '-d', next]);
      signal?.throwIfAborted();
      if (!findBackgroundBrowser(next, {key})) throw new Error('The downloaded browser executable was not found.');
      fs.rmSync(dir, {recursive: true, force: true}); fs.renameSync(next, dir);
      onProgress({step: 'ready', share: 1});
      return findBackgroundBrowser(dir, {key});
    } finally { fs.rmSync(temp, {recursive: true, force: true}); fs.rmSync(next, {recursive: true, force: true}); }
  })();
}

/** The add-on the window drives ('backgroundBrowserProgress'): find the runtime in <data folder>/background-browser-runtime, or download it on a press. */
export function backgroundBrowserAddon(storage, {toWindow = () => {}, toast = () => {}, install = installBackgroundBrowser, find = findBackgroundBrowser} = {}) {
  return optionalAddon({dir: storage.path('background-browser-runtime'), event: 'backgroundBrowserProgress', toWindow, toast, install, find,
    notice: {title: "Getting Jobadabra's browser", body: 'About 200 MB, only once. It fills forms in the background, out of sight.', target: {view: 'sessions'}, tone: 'info'}});
}

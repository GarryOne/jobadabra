// The browser and extension setup IPC (moved out of main.js, 8 Oct 2026): showing a job's form tab, reloading it, opening Notion and folders,
// the extension's install state and how to install it, stray Chrome processes. main.js passes in the services they share.
// Guards: the extension-install and form-tab tests in desktop/test and the apply e2e rows (npm run flows).
import * as apply from './apply.js';
import * as backgroundChrome from './background-chrome.js';
import * as extensionInstall from './extension-install.js';
import * as pipeline from './pipeline.js';
import * as review from './review.js';
import * as server from './server.js';
import path from 'node:path';
import {reloadFormTab} from './form-tab.js';
import {launchOnce} from './chrome-launch-once.js';

export function registerBrowserHandlers(ctx) {
  const {app, clipboard, ipcMain, openNotion, shell, showForm, storage} = ctx;
  // "Open filled form": Chrome, switched to the form's tab (lib/form-tab.js).
  // "Open filled form": the session's form tab through the extension (an empty label: bring it forward, no scroll).
  // `taken` says whether the page's panel answered — the one thing the window needs to know whether the "Reload the
  // tab" repair applies (1 Oct 2026: it was offered always, next to Open filled form, though it reloads a form page).
  ipcMain.handle('showBrowser', async (_, url, company, id) => (id
    ? (await showForm(id, '', url, company))
    : {went: 'none', taken: true}));
  // "Reload the tab": the repair for a form page whose panel died with an older extension. Chrome reloads that tab,
  // then the page's fresh panel answers the focus handshake, so one press both heals and brings Chrome to the field.
  ipcMain.handle('reviewReload', async (_, id, url, company) => {
    const seen = server.extensionSeen(), latest = server.latestExtension();
    const current = !!seen?.version && seen.version === latest;  // an older copy ignores the command below, silently
    // 1. The page's own panel: it reloads itself, in whatever browser and instance it runs (no macOS permission).
    if (current) {
      review.queueReload(String(id));
      if (await review.delivered(String(id), 4000)) return {result: 'reloaded', extension: seen.version, latest};
    }
    // 2. No page answered (a panel from an older extension instance can't): Chrome's own scripting can reload the
    //    tab without the extension. It needs the user's Automation permission, and it reaches one instance only.
    const result = await reloadFormTab({id: String(id), boundTab: review.tabOf(String(id))});
    if (result !== 'reloaded') {
      return {result, extension: seen?.version || '', latest, outdated: !current,
        stray: result === 'no-window' ? (await backgroundChrome.stray())[0] || null : null};
    }
    await new Promise(resolve => setTimeout(resolve, 2500));  // the panel boots and reports within a second or two
    return {result: 'reloaded-chrome', extension: seen?.version || '', latest, ...(await showForm(String(id), '', String(url), String(company || '')))};
  });
  // Notion pages open where the user is already signed in: the Notion app when it's installed, else the
  // browser. ⌘-click opens the app's own Notion window instead (its own sign-in, kept between restarts).
  ipcMain.handle('openNotion', (_, url, inWindow) => {
    if (inWindow) return openNotion(url);
    if (app.getApplicationNameForProtocol('notion://')) return shell.openExternal(url.replace(/^https:\/\//, 'notion://'));
    return shell.openExternal(url);
  });
  ipcMain.handle('showFolder', (_, name) => shell.openPath(name === 'extension' ? path.join(pipeline.REPO, 'extension') : storage.dir));
  ipcMain.handle('extensionInfo', () => ({url: `http://127.0.0.1:${server.PORT}`, token: server.extensionToken(storage)}));
  // A windowless Chrome left behind by an automation holds macOS's one Apple Event connection to Chrome, so this app
  // cannot reach the user's own window. Reported so the card can offer to quit it; only ever an orphaned one
  // (lib/background-chrome.js), never a running automation's.
  ipcMain.handle('strayChrome', () => backgroundChrome.stray());
  ipcMain.handle('quitStrayChrome', (_, pid) => backgroundChrome.quit(Number(pid)));
  const extensionFolder = () => path.join(pipeline.REPO, 'extension');
  // The Chrome extension from the browsers' own records: is it installed, is it on, is that browser up, and which
  // copy is loaded. A file read answers in milliseconds — Settings no longer shows "Checking…" for a minute and then
  // calls it "not connected" (1 Oct 2026).
  ipcMain.handle('extensionInstall', async () => {
    const installed = extensionInstall.installed({folder: extensionFolder()});
    let browserUp = null;
    if (installed.length) {
      const up = await Promise.all([...new Set(installed.map(entry => entry.app))].map(app => extensionInstall.running(app)));
      browserUp = up.some(Boolean);
    }
    return {folder: extensionFolder(), latest: server.latestExtension(), installed, browserUp, browser: apply.launchBrowser(),
      looked: extensionInstall.lookedFor({})};  // where it was looked for, for a browser that keeps profiles elsewhere
  });
  // The computer's part of installing it, in one press: Chrome on its extensions page, the extension's folder in
  // front of the user, and its path on the clipboard — the Load unpacked dialog then takes ⌘⇧G, ⌘V, Return.
  // The step-1 chip: try to open Chrome on its extensions page, and put the URL on the clipboard too — Chrome
  // ignores chrome:// URLs handed to it from outside often enough that the paste has to be the reliable half.
  // "Add to Chrome": the extension's Chrome Web Store page, in the browser the extension is (or will be) in.
  ipcMain.handle('extensionStore', async () => ({opened: await extensionInstall.openStorePage({browser: apply.extensionBrowser()})}));
  ipcMain.handle('extensionPage', async () => {
    const browser = apply.extensionBrowser();
    clipboard.writeText(extensionInstall.extensionsUrl(browser));
    return {opened: await extensionInstall.openExtensionsPage({browser})};
  });
  // Step 2's computer part: the folder in front of the user and its path on the clipboard, so Chrome's Load
  // unpacked dialog takes ⌘⇧G, ⌘V, Return. Chrome's own extensions page is the step-1 chip's job.
  ipcMain.handle('extensionShow', async () => {
    clipboard.writeText(extensionFolder());
    const opened = !(await shell.openPath(extensionFolder()));  // openPath resolves to an error string when it fails
    return {folder: extensionFolder(), opened};
  });
  // The extension's own options page: its "Connect to the Jobadabra app" is what starts it reporting. The ID the
  // browser recorded is authoritative (a manifest "key" makes it differ from the folder path's hash).
  // Every "Open Chrome" / Connect press comes here: one launch while Chrome is starting (lib/chrome-launch-once.js).
  ipcMain.handle('extensionOptions', launchOnce(async () => {
    const found = extensionInstall.installed({folder: extensionFolder()});
    const copy = found.find(entry => entry.current) || found[0] || null;
    return copy?.id ? await extensionInstall.openInChrome(`chrome-extension://${copy.id}/options.html`, {browser: copy.app})
      : await extensionInstall.openOptionsPage(copy?.folder || extensionFolder());
  }, () => server.extensionSeen()?.at || 0));
}

// The app's updates and menu (moved out of main.js, 8 Oct 2026): the check for a newer release, installing it, the application menu with Check for Updates, the beta and tester
// switches, and the setup-funnel tracking. The update offer and when it was last checked stay inside; main.js reaches them through accessors.
// Guards: the updater, app-menu, setup-funnel and beta tests in desktop/test.
import * as appMenu from './app-menu.js';
import * as setupFunnel from './setup-funnel.js';
import * as updater from './updater.js';
import {createUpdateChannel} from './update-channel.js';
import {log as appLog, logFile} from './log.js';

export function createAppUpdates(ctx) {
  const {Menu, app, dialog, getStorage, getTelemetry, toWindow, track, getWindow, isDemo = () => false, openExternal = () => {}, zoom = null, windowsStore = process.windowsStore} = ctx;
  const storage = {settings: () => getStorage().settings(), saveSettings: patch => getStorage().saveSettings(patch)};   // storage is made after this runs: every use goes through the getter
  let updateOffer = null;  // the newer stable release, when there is one (lib/updater.js)
  let updateCheckedAt = null;  // the last check that reached GitHub (Settings → Diagnostics shows it)

  // Running from source (npm start): never offer or install an update. It would quit the dev app and open the
  // downloaded one in its place. From source, updating is `git pull` + restart.
  const FROM_SOURCE = !app.isPackaged;
  // Installed from the Microsoft Store (MSIX): the Store updates it. Our own .exe would put a second, non-Store copy beside it, the one SmartScreen warns about.
  const FROM_STORE = !FROM_SOURCE && !!windowsStore;
  const NO_SELF_UPDATE = FROM_SOURCE || FROM_STORE;
  const betaOn = () => storage.settings().betaChannel === true;   // opt-in, off by default (Settings → Diagnostics → Beta, or the menu's Update Channel)
  // A tester: the person switched the beta on (versions are plain X.Y.Z since 0.5: the channel says how proven a build is).
  const testOn = () => storage.settings().testChannel === true;   // opt-in, off by default (Settings → Diagnostics → Test builds): unchecked builds, newest first
  const channel = () => (testOn() ? 'test' : betaOn() ? 'beta' : 'stable');
  const testerOn = () => betaOn() || testOn();
  // The tester's run-log switch. Saved as `alphaLogs` before 0.5: that choice still counts until the switch is touched.
  const testerLogsOn = () => { const s = storage.settings(); return (s.testerLogs ?? s.alphaLogs) === true; };
  async function checkForUpdate(asked = false) {
    // From source there is nothing to update, except under the e2e's fake release server (JOB_PILOTTO_E2E_UPDATES_URL): the update flow is tested on the real check.
    if (FROM_SOURCE && !(process.env.JOB_PILOTTO_E2E && process.env.JOB_PILOTTO_E2E_UPDATES_URL)) return asked ? {ok: true, offer: null, current: app.getVersion(), fromSource: true} : null;
    if (FROM_STORE) return asked ? {ok: true, offer: null, current: app.getVersion(), fromStore: true} : null;
    try {
      updateOffer = triedBefore(await updater.check(app.getVersion(), {channel: channel()}));
      updateCheckedAt = new Date().toISOString();
      if (updateOffer) { appLog('update', `available: ${updateOffer.version}`); toWindow('update', updateOffer); }
      return {ok: true, offer: updateOffer, current: app.getVersion()};
    } catch (error) {
      return {ok: false, text: `Couldn't check for updates: ${error.message}`, current: app.getVersion()};
    }
  }
  // The last update this install started, and what became of it, read back at the next check: it runs after the app has quit,
  // so only this start can tell. The same version still here means it didn't install (9 Oct 2026: Windows looped "Update to
  // 0.6.15" → closes → 0.6.11 again); that offer then opens the download page instead of the same failing round.
  let triedLogged = false;
  function triedBefore(offer) {
    const tried = storage.settings()?.updateTried;
    if (!tried) return offer;
    const current = app.getVersion();
    if (current !== tried.from) {
      if (!triedLogged) appLog('update', `installed: ${tried.from} → ${current}`);
      storage.saveSettings({updateTried: null});
      return offer;
    }
    if (!triedLogged) appLog('update', `install ${tried.to} over ${tried.from} did not take effect: still ${current}`, {platform: process.platform});
    triedLogged = true;
    return offer && offer.version === tried.to ? {...offer, failedBefore: true} : offer;
  }
  const parentWindow = () => (getWindow() && !getWindow().isDestroyed() ? getWindow() : undefined);
  // The channel switch shared by the menu and Settings → Diagnostics; a change redraws the menu's radio and tells the window to redraw its switches.
  const channels = createUpdateChannel({app, dialog, storage, updater, isLocked: () => isDemo() || NO_SELF_UPDATE, checkForUpdate: () => checkForUpdate(),
    installUpdate: () => installUpdate(), setUpdateOffer: value => { updateOffer = value; }, parentWindow,
    onChange: () => { buildMenu(); toWindow('updateChannel', channels.current()); }});
  // Menu → Update Channel → a channel: switch (asked first), then the same answer as Check for Updates…, with Update now when a build is there.
  async function pickChannel(name) {
    const result = await channels.pick(name);
    buildMenu();   // a cancelled dialog puts the radio back where it was
    if (result.ok === false && result.text) dialog.showMessageBox(parentWindow(), {type: 'warning', message: 'The update channel didn\'t change', detail: result.text, buttons: ['OK']});
    if (result.check) await checkForUpdatesNow();
  }
  function buildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu.template({name: app.name, mac: process.platform === 'darwin',
      checkForUpdates: checkForUpdatesNow, channel: getStorage() ? channels.current() : 'stable', pickChannel: NO_SELF_UPDATE ? null : pickChannel,   // built once before storage exists, then again
      sendFeedback: () => { if (getWindow() && !getWindow().isDestroyed()) { getWindow().show(); toWindow('openFeedback'); } },
      find: what => toWindow('find', what), zoom})));
  }

  // Setup funnel (lib/setup-funnel.js): the furthest step each install reached, sent at once so a quit mid-setup still counts.
  function trackSetup(patch, before) {
    const event = setupFunnel.track(patch, before);
    if (!event) return;
    if (event.step !== 'done') storage.saveSettings({setupFurthest: event.step});
    if (getTelemetry()) { getTelemetry().record('setup', event); getTelemetry().flush(); }
    track('setup_step', {step: event.step, minutes: event.minutes});
  }

  async function installUpdate() {
    if (FROM_SOURCE) return {ok: false, text: 'Running from source (npm start): update with git pull, then restart.'};
    if (FROM_STORE) return {ok: false, text: 'This copy comes from the Microsoft Store: the Store installs its updates.'};
    if (!updateOffer) return {ok: false, text: 'No update to install.'};
    if (updateOffer.failedBefore) {
      appLog('update', `install ${updateOffer.version}: failed before, sending the person to the download page`);
      return {ok: false, manual: true, url: updateOffer.url,
        text: `Updating to ${updateOffer.version} didn't work last time. The download page is opening: run the installer from there (your data stays).`};
    }
    try {
      storage.saveSettings({updateTried: {to: updateOffer.version, from: app.getVersion()}});
      appLog('update', `install ${updateOffer.version} over ${app.getVersion()}: started`);
      await updater.install(updateOffer, {exe: app.getPath('exe'), logFile: logFile(),
        onStep: text => { appLog('update', `install ${updateOffer.version}: ${text}`); toWindow('updateStep', text); },
        quit: () => { appLog('update', `install ${updateOffer.version}: quitting so the new version can be put in place`); app.quit(); },
        explain: async update => { await dialog.showMessageBox(parentWindow(), updater.windowsExplanation(update)); }});  // the quit dialog still asks if a job runs; the swap waits for the app to close
      return {ok: true};
    } catch (error) {
      appLog('update', `install failed: ${error.message}`);
      storage.saveSettings({updateTried: null});   // it never got to quit: nothing to read back at the next start, or the offer reads as "did not take" (#333)
      return {ok: false, text: error.message, url: updateOffer.url};
    }
  }
  // Menu → Check for Updates…: always answers (up to date, an update to install, or why it couldn't check).
  async function checkForUpdatesNow() {
    const shown = appMenu.answer(await checkForUpdate(true), app.getVersion());
    const parent = parentWindow();
    const {response} = await dialog.showMessageBox(parent, {type: shown.type, message: shown.message, detail: shown.detail,
      buttons: shown.buttons, defaultId: 0, cancelId: shown.buttons.length - 1});
    if (!shown.install || response !== 0) return;
    const result = await installUpdate();
    if (result.manual && result.url) openExternal(result.url);
    if (!result.ok) dialog.showMessageBox(parent, {type: 'warning', message: 'The update didn\'t install', detail: result.text, buttons: ['OK']});
  }
  return {getUpdateOffer: () => updateOffer, setUpdateOffer: value => { updateOffer = value; }, getUpdateCheckedAt: () => updateCheckedAt, FROM_SOURCE, FROM_STORE, betaOn, testerOn, testerLogsOn, checkForUpdate, buildMenu, trackSetup, installUpdate, checkForUpdatesNow, channels};
}

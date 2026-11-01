// Which builds this install is offered: stable (default), beta (gate-approved pre-releases) or test builds (a "Build only" run of desktop.yml, nothing checked).
// One place for switching it, used by Settings → Diagnostics (Beta, Test builds, Back to stable; lib/app-meta-handlers.js) and by the menu's
// Update Channel (lib/app-menu.js), so both ask the same question and save the same way. Only a click on the native dialog switches a channel on.
// Guards: desktop/test/update-channel.test.js, app-menu.test.js.
import {log as appLog} from './log.js';

export const CHANNELS = ['stable', 'beta', 'test'];
export const channelOf = settings => (settings.testChannel === true ? 'test' : settings.betaChannel === true ? 'beta' : 'stable');

const ASK = {
  beta: {type: 'question', message: 'Get the beta version?', buttons: ['Join the beta', 'Not now'],
    detail: 'Be the first to test new features. Beta versions pass our automatic checks, but can still have bugs. Jobadabra will offer you each one; nothing installs without your click.\n\nYou can go back to the stable version any time: Settings → Diagnostics → Beta → Back to stable.'},
  test: {type: 'warning', message: 'Get test builds?', buttons: ['Get test builds', 'Not now'],
    detail: 'Test builds are made straight from the latest change, before the end-to-end checks have run on them, so they can be broken. Jobadabra will offer you each one; nothing installs without your click.\n\nYou can go back to the stable version at any time.'},
};

// ctx: {app, dialog, storage, updater, isLocked() (demo or from source), checkForUpdate, installUpdate, setUpdateOffer, parentWindow(), onChange()}
export function createUpdateChannel(ctx) {
  const {app, dialog, storage, updater, isLocked, checkForUpdate, installUpdate, setUpdateOffer, parentWindow, onChange = () => {}} = ctx;
  const locked = {ok: false, text: 'Not in demo mode or when running from source.'};

  // Beta or test builds on (asked first) or off. One channel at a time: turning one on turns the other off.
  async function set(name, want) {
    if (isLocked()) return locked;
    if (want) {
      const ask = ASK[name];
      const {response} = await dialog.showMessageBox(parentWindow(), {...ask, defaultId: 1, cancelId: 1});
      if (response !== 0) return {ok: false, cancelled: true};
    }
    storage.saveSettings(name === 'test' ? {testChannel: !!want, ...(want ? {betaChannel: false} : {})}
      : {betaChannel: !!want, ...(want ? {testChannel: false} : {})});
    appLog('update', name === 'test' ? `test builds ${want ? 'on' : 'off'}` : `beta channel ${want ? 'on' : 'off'}`, {version: app.getVersion()});
    onChange();
    checkForUpdate();
    return {ok: true, on: !!want};
  }

  // Back to stable: installs the latest stable release even though it is older than this beta or test build.
  async function rollback() {
    if (isLocked()) return locked;
    const stable = await updater.stableRelease(app.getVersion()).catch(error => ({error}));
    if (stable?.error) return {ok: false, text: `Couldn't reach GitHub: ${stable.error.message}`};
    if (!stable?.ahead) return {ok: false, text: 'You are not ahead of the stable version.'};
    const {response} = await dialog.showMessageBox(parentWindow(), {type: 'question', message: `Go back to stable ${stable.version}?`, buttons: ['Go back to stable', 'Cancel'], defaultId: 0, cancelId: 1,
      detail: `You have ${app.getVersion()}. The app closes, installs the stable version and opens again. Your jobs and answers stay as they are. The beta is switched off; you can join again any time.`});
    if (response !== 0) return {ok: false, cancelled: true};
    storage.saveSettings({betaChannel: false, testChannel: false});
    onChange();
    setUpdateOffer(stable);
    appLog('update', `back to stable: ${app.getVersion()} -> ${stable.version}`);
    return installUpdate();
  }

  // The menu's Update Channel: switch, then check at once (the caller shows the answer, with Update now when a build is there).
  // Stable on a build ahead of stable offers to go back; declined, the channel stays stable and this build stays installed.
  async function pick(name) {
    const was = channelOf(storage.settings());
    if (name === was) return {ok: true, same: true};
    if (name !== 'stable') {
      const result = await set(name, true);
      return result.ok ? {ok: true, check: true} : result;
    }
    storage.saveSettings({betaChannel: false, testChannel: false});
    appLog('update', `channel ${was} -> stable`, {version: app.getVersion()});
    onChange();
    const back = await rollback();
    if (back.ok === false && !back.cancelled && back.text !== 'You are not ahead of the stable version.') return back;
    return {ok: true};
  }

  return {set, rollback, pick, current: () => channelOf(storage.settings())};
}

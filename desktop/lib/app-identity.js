// The app is called Jobadabra. Its data folder is ~/Library/Application Support/Jobadabra (%APPDATA%\Jobadabra); installs made before the rename
// have it under "Job Pilotto" and are moved at first start (migrateDataFolder). The Keychain item that seals the tokens keeps the old name
// ("Job Pilotto Safe Storage"): renaming it would leave every saved token unreadable (owner, 25 Oct 2026). Guarded by test/app-identity.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LEGACY_NAME = 'Job Pilotto';   // the data folder before the rename, and the Keychain item's name for good
export const DATA_NAME = 'Jobadabra';

// Every folder that is "the app's real data", new name first. A guard that keeps tests, twins and captures off the real folder lists all of them;
// built with the platform's own separators (CI ran the Mac case on Windows: backslashes).
export const realDataFolders = (home = os.homedir(), platform = process.platform, env = process.env) => [DATA_NAME, LEGACY_NAME].map(name => (platform === 'win32'
  ? path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), name)
  : path.posix.join(home, 'Library', 'Application Support', name)));

// The same on every OS: a guard that must refuse the real folder wherever a test names it (a CI run on Windows still names the Mac-style path).
export const everyRealDataFolder = (home = os.homedir(), env = process.env) => [...new Set(['darwin', 'win32'].flatMap(platform => realDataFolders(home, platform, env)))];

// An install from before the rename: the data folder moves to its new name, in one rename (atomic on one volume: it is whole in one place or the other).
// -> the folder to use. If the move fails (a file held open on Windows, a Store package's private folder) the old folder is used as it is and the
// move is tried again at the next start; nothing is copied or deleted. A new folder that is only an empty leftover is replaced.
export function migrateDataFolder(appData, {log = () => {}, store = false} = {}) {
  const current = path.join(appData, DATA_NAME), legacy = path.join(appData, LEGACY_NAME);
  const exists = dir => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };
  if (!exists(legacy)) return current;
  // The Microsoft Store build (MSIX) sees an older installer's folder through the package's file virtualization: a rename there would take it out from under
  // that install and keep it only in the package's private cache (8c's msix spike, 25 Oct 2026). So the Store build never moves a folder it did not create.
  if (store && !exists(current)) { log(`Store build: using the existing ${LEGACY_NAME} data folder as it is`); return legacy; }
  try {
    if (exists(current)) {
      if (fs.readdirSync(current).length) { log(`both ${DATA_NAME} and ${LEGACY_NAME} data folders exist; using ${DATA_NAME}`); return current; }
      fs.rmdirSync(current);
    }
    fs.renameSync(legacy, current);
    log(`moved the data folder ${LEGACY_NAME} -> ${DATA_NAME}`);
    return current;
  } catch (error) {
    log(`could not move the data folder (${error.code || error.message}); using ${LEGACY_NAME} for now`);
    return legacy;
  }
}

// Call before anything reads userData. userDataOverride: a folder set by a test or demo (it wins, and the real folder is not touched at all).
// Electron fixes the Keychain item's name ("<app name> Safe Storage") the first time safeStorage seals something, so seal once under the old name, then take the new one (menus, About).
export function keepLegacyIdentity({app, safeStorage, displayName = 'Jobadabra', userDataOverride = '', log, store = !!process.windowsStore}) {
  app.setName(LEGACY_NAME);
  if (!userDataOverride) app.setPath('userData', migrateDataFolder(app.getPath('appData'), {log, store}));
  app.whenReady().then(() => {
    try { if (safeStorage.isEncryptionAvailable()) safeStorage.encryptString('keychain-name'); } catch { /* no keychain here (CI): nothing to keep */ }
    app.setName(displayName);
  });
}

// Windows: which copies of Jobadabra are installed (Microsoft Store package, the downloaded .exe installer, or both) and what the running copy should tell the person.
//   const copies = detectCopies();                      -> {store, exe, storeData}
//   twoInstallsAction({self: 'exe', copies, ownHasData}) -> 'none' | 'use-store-copy' | 'note'
// Why (31 Oct 2026, owner: "Let's handle the case when the desktop app is being installed twice. Side by side. For example it's installed from Microsoft Store. And then I download the binary
// from the website and install it on top."): measured on a Windows 11 runner (spike runs 41225480744, 41226839388, 41227786172 of msix-spike.yml). The single-instance lock spans both copies in every
// start order, so two copies never run at once. But a Store copy that creates the data folder keeps it in the package's private cache (%LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming\Jobadabra),
// so a .exe copy installed afterwards starts with an empty folder of its own: two data sets, one person.
import fs from 'node:fs';
import path from 'node:path';
import {DATA_NAME, LEGACY_NAME, userDataTime} from './app-identity.js';

export const STORE_IDENTITY = 'IgorMardari.Jobadabra';   // the Store package's identity name (.github/workflows/msix-store.yml); its folder is <identity>_<publisher id>
export const EXE_FOLDER = 'job-pilotto-desktop';         // where the NSIS installer puts the app: %LOCALAPPDATA%\Programs\<this>\Jobadabra.exe (seen in the spike run)

const win = path.win32;
const isDir = dir => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };
const names = dir => { try { return fs.readdirSync(dir); } catch { return []; } };
export const realProbes = {isDir, isFile: file => { try { return fs.statSync(file).isFile(); } catch { return false; } }, names, dataTime: userDataTime};

/**
 * The copies installed for this person. Takes {env, probes} (probes: isDir, isFile, names, dataTime; injected so a test needs no Windows).
 * Returns {store: package folder or '', exe: the installer copy's executable or '', storeData: the Store copy's data folder when it holds a person's data, else ''}.
 * Not on Windows (no LOCALAPPDATA): nothing is found.
 */
export function detectCopies({env = process.env, probes = realProbes} = {}) {
  const local = env.LOCALAPPDATA;
  if (!local) return {store: '', exe: '', storeData: ''};
  const packages = win.join(local, 'Packages');
  const family = probes.names(packages).find(name => name.startsWith(`${STORE_IDENTITY}_`)) || '';
  const store = family ? win.join(packages, family) : '';
  const roaming = store ? win.join(store, 'LocalCache', 'Roaming') : '';
  const storeData = [DATA_NAME, LEGACY_NAME].map(name => win.join(roaming, name)).find(dir => roaming && probes.isDir(dir) && probes.dataTime(dir)) || '';
  const exeFile = win.join(local, 'Programs', EXE_FOLDER, 'Jobadabra.exe');
  return {store, exe: probes.isFile(exeFile) ? exeFile : '', storeData};
}

/**
 * What this running copy says. Takes {self: 'store' | 'exe', copies (detectCopies), ownHasData}.
 *  - 'use-store-copy': this is the installer copy, the Store copy holds the person's data and this one holds none: offer the Store copy before a second setup starts.
 *  - 'note': both are installed and nothing above applies: one note, once.
 *  - 'none': one copy only.
 */
export function twoInstallsAction({self, copies, ownHasData}) {
  if (!copies.store || !copies.exe) return 'none';
  if (self === 'exe' && copies.storeData && !ownHasData) return 'use-store-copy';
  return 'note';
}

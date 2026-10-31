// Windows: is Jobadabra installed twice (the Microsoft Store package and the .exe installer from the website), and the one-time note that says so.
//   const copies = detectCopies();                               -> {store, exe}
// Why (31 Oct 2026, owner: "Let's handle the case when the desktop app is being installed twice. Side by side. For example it's installed from Microsoft Store. And then I download the binary
// from the website and install it on top."): measured on a Windows 11 runner (msix-spike.yml scenarios two-installs and virtualization). The single-instance lock spans both copies in every start
// order, so two copies never run at once; the Store package no longer hides AppData (scripts/appx-manifest.mjs), so both use %APPDATA%\Jobadabra, except a Store copy first used on a clean PC,
// which still keeps its data in the package's own folder (JOB-165). What is left is the person's own clutter: two Start menu entries and two update routes (the Store copy updates through
// the Store, the installer copy from GitHub). The note that says so is lib/two-installs-notice.js.
import fs from 'node:fs';
import path from 'node:path';

export const STORE_IDENTITY = 'IgorMardari.Jobadabra';   // the Store package's identity name (.github/workflows/msix-store.yml); its folder is <identity>_<publisher id>
export const EXE_FOLDER = 'job-pilotto-desktop';         // where the NSIS installer puts the app: %LOCALAPPDATA%\Programs\<this>\Jobadabra.exe (measured: msix-spike.yml run 41232577742, inventory line "nsis exe")

const win = path.win32;
const names = dir => { try { return fs.readdirSync(dir); } catch { return []; } };
const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
export const realProbes = {names, isFile};

/**
 * The copies installed for this person. Takes {env, probes} (probes: names(dir), isFile(file); injected so a test needs no Windows).
 * Returns {store: the package's folder or '', exe: the installer copy's executable or ''}. Without LOCALAPPDATA (Mac, Linux) nothing is found and nothing is read.
 */
export function detectCopies({env = process.env, probes = realProbes} = {}) {
  const local = env.LOCALAPPDATA;
  if (!local) return {store: '', exe: ''};
  const packages = win.join(local, 'Packages');
  const family = probes.names(packages).find(name => name.startsWith(`${STORE_IDENTITY}_`)) || '';
  const exeFile = win.join(local, 'Programs', EXE_FOLDER, 'Jobadabra.exe');
  return {store: family ? win.join(packages, family) : '', exe: probes.isFile(exeFile) ? exeFile : ''};
}

/** True when both the Store package and the installer copy are installed. */
export const installedTwice = copies => !!(copies.store && copies.exe);

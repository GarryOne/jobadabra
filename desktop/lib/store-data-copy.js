// A Microsoft Store user whose data sits in the package's private cache gets it in the real data folder, once, when the Store package stops hiding AppData (scripts/appx-manifest.mjs).
//   handOff({app, log})  -> true when it started the helper and the app is quitting; false: carry on starting
// Why (31 Oct 2026, owner: "Build the copy"; the Store listing is live since 26 Oct, Store installs are not tracked, so assume real users have private data): measured on a Windows runner
// (msix-spike.yml scenario virtualization): once the package writes unvirtualized, the app no longer sees %LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming\Jobadabra, so an upgraded Store
// user would open at the setup. The copy runs in lib/store-data-copy-helper.mjs after the app exits (the key that unseals secrets.json lives in `Local State`, which a running app rewrites).
// Never over a real folder that already holds a person's data, never a delete of the private copy, once (a marker), at most MAX_TRIES hand-offs so a copy that cannot finish never loops restarts.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {DATA_NAME, LEGACY_NAME, userDataTime} from './app-identity.js';
import {readMarker, writeMarker} from './store-data-copy-helper.mjs';

export const MAX_TRIES = 2;
// Why (31 Oct 2026): a script inside app.asar cannot be started by a separate node process reliably; the helper is unpacked (package.json build.asarUnpack) and is a .mjs so it runs as a module with no package.json beside it.
export const unpackedHelper = () => fileURLToPath(new URL('./store-data-copy-helper.mjs', import.meta.url)).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

/**
 * The running Store copy's own package folder under %LOCALAPPDATA%\Packages, from its executable's path: C:\Program Files\WindowsApps\<Name>_<version>_<arch>_<resource>_<publisher id>\app\Jobadabra.exe
 * -> <local>\Packages\<Name>_<publisher id>. '' when the path is not a Store package's. Why (31 Oct 2026, spike run 41231364697): the copy must not depend on our production package name, a test package has another.
 */
export function ownPackageFolder(exePath, local) {
  const match = /[\\/]WindowsApps[\\/]([^\\/_]+)_[^\\/_]*_[^\\/_]*_[^\\/_]*_([^\\/_]+)[\\/]/i.exec(exePath || '');
  return match && local ? path.join(local, 'Packages', `${match[1]}_${match[2]}`) : '';
}

/** The private cache folder that holds a person's data for this package, or ''. Takes the package's folder (ownPackageFolder). */
export function privateDataFolder(store, time = userDataTime) {
  if (!store) return '';
  return [DATA_NAME, LEGACY_NAME].map(name => path.join(store, 'LocalCache', 'Roaming', name)).find(dir => time(dir) > 0) || '';
}

/**
 * What to do. Takes {target, cache, time}: 'none' (no private data), 'done' (copied before), 'both-have-data' (the real folder has data of its own: nothing moves),
 * 'gave-up' (MAX_TRIES hand-offs did not finish), 'copy'.
 */
export function planCopy({target, cache, time = userDataTime}) {
  if (!cache) return 'none';
  const marker = readMarker(target);
  if (marker.state === 'done') return 'done';
  if (marker.state === 'started' || marker.state === 'failed') return (marker.tries || 0) >= MAX_TRIES ? 'gave-up' : 'copy';
  return time(target) > 0 ? 'both-have-data' : 'copy';
}

/**
 * Run at start, after the single-instance lock. Takes {app, log, platform, windowsStore, exePath, local, spawnFn}. For a packaged Store copy with private data and a real folder without any:
 * writes the marker (try n), starts the helper detached and quits this process. Returns true when it did.
 */
export function handOff({app, log = () => {}, platform = process.platform, windowsStore = !!process.windowsStore, exePath = process.execPath, local = process.env.LOCALAPPDATA, spawnFn = spawn, helper = unpackedHelper()}) {
  if (platform !== 'win32' || !windowsStore || !app.isPackaged) return false;
  const cache = privateDataFolder(ownPackageFolder(exePath, local)), target = app.getPath('userData');
  const plan = planCopy({target, cache});
  if (plan !== 'copy') { if (plan !== 'none') log(`Store data copy: ${plan}`); return false; }
  const marker = readMarker(target);
  writeMarker(target, {state: 'started', tries: (marker.tries || 0) + 1, from: cache, at: new Date().toISOString()});
  log(`Store data copy: moving the private data of the Store copy into ${target}, then restarting (try ${(marker.tries || 0) + 1})`);
  spawnFn(process.execPath, [helper, String(process.pid), cache, target, process.execPath, ...process.argv.slice(1)], {detached: true, stdio: 'ignore', env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}}).unref();
  app.exit(0);
  return true;
}

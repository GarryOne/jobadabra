// The one skip for a desktop test that renders the app in electron: it names a missing capability (no electron binary, no display), never "CI".
// Why (31 Oct 2026, owner: "was this a flaky e2e? OR what's the root cause of this ? How did it endup in main ?"): `skip: process.env.CI` let palette-one-row-per-card
// go red on main with no run ever executing it; CI now installs electron and runs these under xvfb (tests-desktop.yml), and
// test/skips-name-a-capability.test.js fails when a skip says CI instead.
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const desktop = fileURLToPath(new URL('..', import.meta.url));

/**
 * True when the electron binary was downloaded: install.js writes node_modules/electron/path.txt only then. Not `node_modules/.bin/electron`: npm links that shim
 * from the package's `bin` on every install, also on Windows CI where no binary is downloaded, and the tests would then fail instead of skip (Gitar, #2698).
 * Electron 44 has no install script: the binary comes only from `node node_modules/electron/install.js` (a CI step) or the first launch.
 */
export const electronInstalled = (root = desktop) => existsSync(`${root}node_modules/electron/path.txt`);

/** The reason this machine cannot render the app, or false when it can: no electron binary, or Linux without an X display. */
export function cannotRender(env = process.env, platform = process.platform, hasElectron = electronInstalled()) {
  if (!hasElectron) return 'no electron binary installed';
  if (platform === 'linux' && !env.DISPLAY) return 'no display (run under xvfb-run)';
  return false;
}

/**
 * The options for `test(name, needsElectron, fn)`: skip with the reason from cannotRender(), run otherwise. Where DESKTOP_RENDER_REQUIRED is set (the Linux desktop jobs
 * of tests-desktop.yml and build.yml, which install electron and a display) a missing capability throws instead: the tests fail loudly, never skip green.
 * Why (31 Oct 2026, #2698 try 2): path.txt is absent on a fresh CI install, so every rendering test skipped and the job still passed.
 */
export function renderOptions(env = process.env, platform = process.platform, hasElectron = electronInstalled()) {
  const reason = cannotRender(env, platform, hasElectron);
  if (reason && env.DESKTOP_RENDER_REQUIRED) throw new Error(`this job promises to render the app but cannot: ${reason}`);
  return {skip: reason};
}

export const needsElectron = renderOptions();

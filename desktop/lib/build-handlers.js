// Which build runs, over IPC (owner, 16 Oct 2026): the commit the window runs and, when PRs that change desktop/extension were merged into the checkout since the app started, "Restart to get N fixes".
// A package says its commit from build-info.json (scripts/stage.mjs); a source run from the checkout's HEAD at start. A package gets its fixes through the sidebar's Update button (lib/updater.js), so it is never "ahead" here.
// Packaged builds show "v<version> · What's new" (whatsNew = the changelog URL), source runs "<commit> · <time>".
// Guards: test/build-state.test.js (the numbers), test/build-handlers.test.js (the two handlers).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {appBuild, headBuild, restartLabel} from './build-state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CHANGELOG = 'https://www.jobadabra.top/changelog';
export const packagedBuild = () => packagedInfo();
const packagedInfo = () => { try { const info = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'build-info.json'), 'utf8')); return {commit: String(info.commit || ''), time: String(info.at || info.date || '')}; } catch { return null; } };

export function registerBuildHandlers({app, ipcMain, restartApp, FROM_SOURCE, repo, packaged = packagedInfo(), head = headBuild, count = appBuild}) {
  const running = packaged || head(repo);   // fixed at start: what is RUNNING, not what the checkout is now
  ipcMain.handle('buildState', () => {
    const state = count({repo, running}), ahead = FROM_SOURCE ? state.ahead : 0;
    // A package (stable or beta) tells users its version and links the changelog; a source run keeps the commit and time (owner, 17 Oct 2026: "Version for users").
    const version = FROM_SOURCE ? '' : String(app.getVersion?.() || '');
    const shown = version ? {label: `v${version}`, whatsNew: CHANGELOG} : {};
    return {...state, ...shown, ahead, restart: ahead ? restartLabel(ahead) : '', fromSource: !!FROM_SOURCE};
  });
  // The app's own quit guard still asks when a job is running (before-quit); the relaunch happens after it, once (lib/restart.js).
  ipcMain.handle('restartApp', () => { restartApp('restart to get fixes'); return {ok: true}; });
}

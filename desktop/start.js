// The app's entry. In a source checkout (a new git worktree, a fresh clone) the files main.js imports from shared/ may
// not be built yet: build them first (scripts/stage.mjs; a packaged app has them and no scripts/). In a test run
// (JOBADABRA_SMOKE…) a start that fails is written to stderr and the app quits, instead of Electron's error dialog
// popping up on the owner's screen from a hidden test window.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stage = path.join(here, 'scripts', 'stage.mjs');
if (!fs.existsSync(path.join(here, 'shared', 'app-core', 'extension.js')) && fs.existsSync(stage)) {
  try {
    execFileSync(process.execPath, [stage], {cwd: here, stdio: 'inherit', env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}});
  } catch (error) { console.error(`Building shared/ failed: ${error.message}`); }
}
const testRun = Object.keys(process.env).some(name => name.startsWith('JOBADABRA_SMOKE') || name === 'JOBADABRA_PTY_SMOKE');
try {
  await import('./main.js');
} catch (error) {
  if (!testRun) throw error;
  console.error(`Jobadabra could not start: ${error.stack || error}`);
  (await import('electron')).app.exit(1);
}

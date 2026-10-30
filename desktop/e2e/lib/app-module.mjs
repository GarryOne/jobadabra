// Load staged app modules from desktop so their dependencies belong to the app's own install.
// Job: run the backbone
// Reaches: ../../lib/ (app modules are resolved from desktop/package.json, never copied into the harness)
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ensureStaged} from './ensure-staged.mjs';

const appPackage = new URL('../../package.json', import.meta.url);
const fromApp = createRequire(appPackage);

/** Stage shared files and import a path relative to desktop/lib; app packages always resolve from the desktop tree. */
export async function loadAppModule(name) {
  ensureStaged(dirname(fileURLToPath(appPackage)));
  return import(pathToFileURL(fromApp.resolve(`./lib/${name}`)).href);
}

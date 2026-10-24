// Does the app's launcher find Microsoft Edge, and does Edge load the unpacked Jobadabra extension? Run by .github/workflows/edge-check.yml on a Windows runner (Edge is preinstalled there).
// The launcher check must pass; whether branded Edge still honours --load-extension is reported, not enforced (Chrome 137+ stopped; Edge may have too).
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserCommand} from '../lib/browser-launch.js';

const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');
const note = (level, text) => console.log(process.env.GITHUB_ACTIONS ? `::${level}::${text}` : `${level}: ${text}`);

const command = browserCommand(['about:blank'], process.platform, process.env, fs.existsSync, 'Microsoft Edge');
console.log('launcher says:', JSON.stringify(command));
if (!command || !/msedge(\.exe)?$|open$/.test(command[0]) && !command[1].includes('Microsoft Edge')) { note('error', 'the launcher did not pick Edge'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-edge-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'msedge', headless: false, ignoreDefaultArgs: ['--disable-extensions', '--disable-popup-blocking'],
  args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run'],
});
console.log('Edge version:', context.browser()?.version());
let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent('serviceworker', {timeout: 20000}).catch(() => null);
if (worker) console.log('extension loaded in Edge:', worker.url());
else note('warning', 'Edge started but did not load the unpacked extension (--load-extension ignored?)');
await context.close();

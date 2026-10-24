/* global document */
// The real Chrome extension (a copy with the test port) in a real Chromium, for the apply suite. Chromium loads the extension folder as it is (extension/), the fixture forms answer to the
// job-site host names the extension is allowed on (lib/forms.mjs), and the app's own "Apply" click reaches this browser through a stand-in `open` command
// on the app's PATH (the app runs `open -a "Google Chrome" <url>`: here that URL is handed to this Chromium instead).
import {guardLiveVisit} from './site-ledger.mjs';
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import {leanChrome} from './chrome-lean.mjs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {E2E} from './app.mjs';
import {hostRules} from './forms.mjs';
import {stamp, stampedAt} from '../../scripts/extension-stamp.mjs';
import {LAUNCH_TIMEOUT_MS, launchGuard} from './launch-guard.mjs';

export const EXTENSION_DIR = path.resolve(E2E, '..', '..', 'extension');
export const DEFAULT_APP_PORT = 47111;   // the extension's built-in address for the app (extension/flow.js APP)

// A port nothing listens on. The test app and its extension use it, so the suite runs next to the user's own Jobadabra, which keeps 47111: the extension
// under test can never pair with a live app.
export async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { const {port: got} = server.address(); server.close(() => resolve(got)); });
    });
    if (port !== DEFAULT_APP_PORT) return port;
  }
}

// A copy of the extension folder whose built-in app address is `port` (extension/ itself is never edited). Throws when the address is not found in the
// source: a rewrite that silently did nothing would leave the extension talking to the live app on 47111.
// `into`: rewrite an existing copy in place (a twin's browser has it loaded: twin-refresh.mjs); otherwise a fresh temp folder.
export function copyExtension(port, from = EXTENSION_DIR, into = '') {
  const dir = into || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-ext-')), 'extension');
  fs.cpSync(from, dir, {recursive: true});
  // A copy of a checkout's extension/ carries the version its build would stamp (scripts/extension-stamp.mjs): the twin's refresh prints it, the pool reports it.
  // An old build's folder (REAL_EXTENSION_DIR, not a checkout) keeps its own.
  const repo = path.dirname(path.resolve(from));
  if (fs.existsSync(path.join(repo, '.git'))) { const version = stampedAt(repo); if (version) stamp(dir, version); }
  const flow = path.join(dir, 'flow.js');
  const source = fs.readFileSync(flow, 'utf8');
  const address = `http://127.0.0.1:${DEFAULT_APP_PORT}`;
  if (!source.includes(address)) throw new Error(`extension/flow.js no longer contains ${address}: update copyExtension() (the test extension must not talk to port ${DEFAULT_APP_PORT})`);
  fs.writeFileSync(flow, source.replaceAll(address, `http://127.0.0.1:${port}`));
  const left = fs.readdirSync(dir).filter(file => file.endsWith('.js') && fs.readFileSync(path.join(dir, file), 'utf8').includes(`127.0.0.1:${DEFAULT_APP_PORT}`));
  if (left.length) throw new Error(`the test extension still mentions 127.0.0.1:${DEFAULT_APP_PORT} in ${left.join(', ')}`);
  if (process.env.LIVE) {   // the live run (lib/apply-live.mjs): a fresh Chrome has not granted the optional "any site" permission the owner's Chrome has, so the test copy holds it
    const manifestFile = path.join(dir, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), 'https://*/*'])];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    if (!process.env.LIVE_SUBMIT) {   // a live run stops BEFORE the account form's own button (creating a real account is the owner's go: LIVE_SUBMIT=1)
      const step = path.join(dir, 'account-step.js'), text = fs.readFileSync(step, 'utf8'), press = "if (move === 'fill-press' && !(await alreadyTried(tab, submitKey))) {";
      if (!text.includes(press)) throw new Error('extension/account-step.js no longer contains the press guard: update copyExtension() (a live run must not press the account button)');
      fs.writeFileSync(step, text.replace(press, "if (move === 'fill-press') decide('fill', 'HELD by the live test: the consent and the account button are not pressed (LIVE_SUBMIT=1 lets them)', {host});\n  if (false && move === 'fill-press' && !(await alreadyTried(tab, submitKey))) {"));
    }
  }
  return dir;
}

// A folder with an `open` that writes the URL it was given into a spool folder (the app finds it first on PATH). -> {bin, spool}
export function makeOpenShim() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-open-'));
  const bin = path.join(root, 'bin'), spool = path.join(root, 'spool');
  fs.mkdirSync(bin); fs.mkdirSync(spool);
  // The URL is the first http(s) argument, not the last: `open -a "Google Chrome" <url> --args --profile-directory=<p>` (lib/browser-launch.js) ends
  // with a flag (16 Oct 2026: on a Mac with Chrome the stand-in recorded the flag, so every Apply looked unopened). Guard: e2e/test/open-shim.test.mjs.
  fs.writeFileSync(path.join(bin, 'open'), '#!/bin/sh\nurl=\nfor a; do case "$a" in http://*|https://*) [ -z "$url" ] && url=$a;; esac; done\n[ -n "$url" ] || exit 0\n'
    + 'f=$(mktemp "$JOB_PILOTTO_E2E_OPEN_DIR/open.XXXXXX") && printf \'%s\' "$url" > "$f" && mv "$f" "$f.url"\n', {mode: 0o755});
  // Windows has no `open`: the app runs `node <script> <urls>` instead (lib/apply.js chromeCommand, JOB_PILOTTO_E2E_OPENER). Same spool, same .url files.
  const script = path.join(root, 'open.mjs');
  fs.writeFileSync(script, "import fs from 'node:fs'; import path from 'node:path';\nconst dir = process.env.JOB_PILOTTO_E2E_OPEN_DIR, url = process.argv.slice(2).find(arg => /^https?:\\/\\//.test(arg));\n" +
    "if (!url) process.exit(0);\nconst file = path.join(dir, `open.${process.pid}.${Date.now()}`); fs.writeFileSync(file, url); fs.renameSync(file, `${file}.url`);\n");
  return {bin, spool, script};
}

// E2E_BROWSER=msedge: the same suite in Microsoft Edge (preinstalled on the Windows runners) instead of Playwright's Chromium. Edge 153 loads the
// unpacked extension with --load-extension (checked 5 Oct 2026, edge-check.yml).
export const browserChannel = (env = process.env) => (env.E2E_BROWSER === 'msedge' ? {channel: 'msedge'} : {});

// -> {context, opened: [url], serviceWorker(), page(url), close()}. Every URL the app opens is opened here, in a new tab.
// The per-site daily limit (lib/site-ledger.mjs) is for live visits: a fixture browser's addresses resolve to the fixture server and are never counted
// (12 Oct 2026: local apply runs used up jobs.lever.co's 3 a day and the next run's Lever step was refused). Guard: test/extension-browser.test.mjs.
export const visitGuard = real => (real ? (url, options) => guardLiveVisit(url, options) : () => null);
// `real`: a live-test twin's window (e2e/twin.mjs): real sites (no fixture host mapping), always visible.
// `profile`: a browser profile kept between runs (the twin's: site sign-ins and cookies survive); else a fresh temp one.
// `debugPort`: the browser's own debugging port (the twin's: its tabs can be seen and driven from outside, like its app window).
export async function launchBrowser({port, spool, extensionDir, real = false, profile: kept = '', debugPort = 0}) {
  if (kept) fs.mkdirSync(kept, {recursive: true});
  const profile = kept || fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-chromium-'));
  launchGuard.check();   // a browser that did not start earlier in this process: stop now, never wait again per journey (lib/launch-guard.mjs)
  const context = await chromium.launchPersistentContext(profile, {
    ...browserChannel(), headless: false, ignoreHTTPSErrors: !real, ...(real ? {viewport: null} : {}), ignoreDefaultArgs: ['--disable-extensions', '--disable-popup-blocking'], timeout: LAUNCH_TIMEOUT_MS,
    args: [...(process.env.E2E_HEADED || real ? [] : ['--headless=new']), `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`,
      ...(real ? [] : [`--host-resolver-rules=${hostRules(port)}`, '--ignore-certificate-errors']), '--no-first-run', '--no-default-browser-check', ...leanChrome(), ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : [])],
  }).catch(error => { launchGuard.failed(error); throw error; });
  const opened = [], pages = {}, requested = new Set();   // requested: every host name the browser asked for (a test proves no employer site was contacted)
  context.on('request', request => { try { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol)) requested.add(url.hostname); } catch { /* not a URL */ } });
  let stopped = false;
  // One window, one tab to start: the extension opens its settings page when installed (background.js onInstalled), and every test
  // browser is a fresh install, so a settings tab sat beside each test (owner, 8 Oct 2026: "I want to avoid having 2 tabs all the times").
  // That tab is made blank, and the first page a test opens reuses the blank tab instead of adding one.
  const blank = page => /^(about:blank|chrome:\/\/new-?tab|chrome-search:)/.test(page.url());
  const quietSettings = page => { if (page.url().endsWith('/options.html')) page.goto('about:blank').catch(() => {}); };
  const watcher = (async () => {
    while (!stopped) {
      for (const page of context.pages()) quietSettings(page);   // checked on every tick: the install opens it whenever the worker starts
      for (const file of fs.readdirSync(spool).filter(name => name.endsWith('.url'))) {
        const url = fs.readFileSync(path.join(spool, file), 'utf8').trim();
        fs.rmSync(path.join(spool, file));
        if (!/^https:\/\//.test(url)) continue;   // the app asked `open` for something else: nothing to do here
        try { visitGuard(real)(url, {who: process.env.JOB_PILOTTO_SESSION || 'browser'}); } catch (error) { console.error(error.message); continue; }   // the per-site daily limit (lib/site-ledger.mjs): a refused address is not opened
        const tab = context.pages().find(page => blank(page) && !Object.values(pages).includes(page)) || await context.newPage();
        pages[url.split('#')[0]] = tab;
        opened.push(url);   // after the tab exists: a caller that sees the URL finds its tab
        tab.goto(url).catch(() => {});
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  })();
  const serviceWorker = async () => context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
  return {context, opened, pages, requested, serviceWorker,
    close: async () => { stopped = true; await watcher.catch(() => {}); await context.close().catch(() => {}); }};
}

// The form as the page holds it now: field id (or name) -> {type, value, checked, files: [{name, size}], ai}. `ai` is the extension's own marker on an
// answer the AI wrote. Hidden fields are included (a step the person has not reached must not be filled).
export const readForm = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('input, select, textarea')]
  .filter(el => el.type !== 'submit' && el.type !== 'button')
  .map(el => [el.id || el.name, {type: el.type, value: el.type === 'file' ? '' : el.value, checked: !!el.checked, hidden: el.getClientRects().length === 0,
    files: [...(el.files || [])].map(file => ({name: file.name, size: file.size})), ai: el.hasAttribute('data-jobpilotto-ai')}])));

// What the page says the extension is doing: the state the extension writes for Claude on <html data-jobpilotto-fill> ({state: running|done|error|no-form|account, ...}).
// Written by the app's hand-off fill only (background.js handOff): a fill pressed on the panel leaves the last hand-off's state, so wait on readPanel's `filling` for that one.
export const fillState = page => page.evaluate(() => { try { return JSON.parse(document.documentElement.dataset.jobpilottoFill || 'null'); } catch { return null; } });

// The panel the extension draws on the page (bottom right, an open shadow root).
export const readPanel = page => page.evaluate(() => {
  const root = document.getElementById('jobpilotto-review-host')?.shadowRoot;
  if (!root) return null;
  const text = selector => (root.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
  return {pill: text('.pill'), progress: text('.progress-line'), note: root.querySelector('.note')?.hidden ? '' : text('.note'),
    tailor: root.querySelector('.tailor')?.hidden ? '' : text('.tailor'), knock: root.querySelector('.knock')?.hidden ? '' : text('.knock'), tip: root.querySelector('.tip')?.hidden ? null : {chip: text('.tip-chip'), text: text('.tip-text')}, left: [...root.querySelectorAll('.left .item')].map(item => item.textContent.replace(/\s+/g, ' ').trim()), foot: text('.foot'), fillLabel: text('.fill .label'), filling: !!root.querySelector('.fill')?.disabled};   // filling: the panel's own Fill is running (review.js)
});

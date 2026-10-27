/* global document, location, chrome */
// The REAL extension in a real (headless) Chromium on a REAL site, isolated from everything of the owner's: the way to validate a form fix before
// saying it works (docs/rules/applying.md "Validate a form fix on the real extension"). What it cuts off, and proves it did:
//  - the owner's live app: the extension is a copy whose built-in app address (127.0.0.1:47111) is a port nothing but a stand-in answers on
//    (lib/extension.mjs copyExtension), and `assertIsolated()` fails the run if the extension's storage points anywhere else;
//  - the owner's profile, CV, Keychain, Notion and AI: the stand-in app serves fake applicant details and the fixture CV, and answers every
//    other call with {} (no AI, no Notion);
//  - the owner's browser: a temporary profile of Playwright's own Chromium.
// What it cannot imitate: the app's AI (page kind, answers), so the panel's "Fill anyway" is used when the rule calls a page an account page.
// A real third-party site gets only this fake data. Some pages send a chosen file at once (SuccessFactors uploads on choice): only the fixture goes.
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {E2E} from './app.mjs';
import {EXTENSION_DIR, browserChannel, copyExtension, freePort} from './extension.mjs';
import {LAUNCH_TIMEOUT_MS, launchGuard} from './launch-guard.mjs';
import {setExtensionStorage} from '../../../hosted/ready-fill/extension-storage.mjs';
import {replayLimit} from './replay-deadline.mjs';

// The extension's stored settings (chrome.storage.local as JSON) -> '' or why it is not isolated: its app address is not the stand-in's port, or an address
// on the live app's port 47111 is stored anywhere. An ADDRESS, never the bare digits: 27 Oct 2026 (run 40447725087) a stored timestamp, "boot":"1793074711121",
// contains 47111 and failed an isolated run as "NOT ISOLATED" (the second try passed with another timestamp). Guard: test/isolation-check.test.mjs.
const LIVE_ADDRESS = /(?:127\.0\.0\.1|localhost|\[::1\]):47111(?!\d)/;
export function isolationProblem(stored, port) {
  const text = String(stored || ''), wrongUrl = !text.includes(`"workerUrl":"http://127.0.0.1:${port}"`), live = LIVE_ADDRESS.exec(text);
  if (!wrongUrl && !live) return '';
  return `NOT ISOLATED: the extension is not on the stand-in app's port ${port} (${wrongUrl ? `workerUrl stored: ${text.match(/"workerUrl":"[^"]*"/)?.[0] || 'none'}`
    : `"${live[0]}" stored at ${live.index}: …${text.slice(Math.max(0, live.index - 40), live.index + 40)}…`}; ${text.length} characters stored)`;
}

export const FIXTURE_CV = path.join(E2E, 'fixtures', 'cv.pdf');
const pdf = (name, source = FIXTURE_CV) => ({data: fs.readFileSync(source).toString('base64'), name, type: 'application/pdf'});
export const FAKE_CONTACT = {first_name: 'Test', last_name: 'Candidate', email: 'test.candidate@example.com'};

// options: {extensionDir (default: this checkout's extension/), cv: true|false (the CV the app has), letter: true|false (an approved cover letter file),
// contact (fake details)}. -> {context, page, port, requests, assertIsolated, panel, fillWithPanel, told, controlReports, close}
export async function startRealExtension({extensionDir = EXTENSION_DIR, cv = true, letter = false, contact = FAKE_CONTACT, answer = {}, allowAllSites = false, offline = false, appPort = 0, cdp = false, timezoneId = '', contactFor = null} = {}) {   // answer: {route: () => body} the stub app gives instead of {} (e.g. the page-kind AI's word)
  const port = appPort || await freePort();   // appPort: the caller's own stand-in app answers on it (row replay): this file starts no stub, and `answer`/`requests` stay unused
  const copy = copyExtension(port, extensionDir);
  // allowAllSites: a fresh test Chrome has not pressed the extension's Allow (the optional "any site" permission a person has granted once), so a site outside the
  // hiring systems in manifest.json (a local copy of Deloitte's page) would wait for Allow. The copy holds it, as if the person had pressed it; the default leaves it out.
  if (allowAllSites) {
    const manifestFile = path.join(copy, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), 'https://*/*'])];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  }
  const requests = [];
  const answers = {'/extension/pair': () => ({url: `http://127.0.0.1:${port}`, token: 'e2e'}),
    '/extension/run': () => ({ok: true, id: 'e2e-run'}),   // the app's store answers with the run's id: the extension's record update is sent to that run (extension/ladder/record-update.js)
    '/extension/me': (body, query) => ({contact: contactFor?.(query) || contact, contactSource: 'e2e', ...(cv ? {resume: pdf('cv.pdf')} : {}), ...(letter ? {coverLetterFile: pdf('letter.pdf')} : {})})};
  const stub = appPort ? null : http.createServer((request, response) => {
    const headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json'};
    if (request.method === 'OPTIONS') { response.writeHead(204, headers); response.end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const route = request.url.split('?')[0];
      requests.push({route, body: body.slice(0, route === '/extension/run' ? 2000000 : 20000)});   // the fill record whole: lib/replay-truth.mjs reads its trace
      Promise.resolve(answers[route] ? answers[route](body, new URL(request.url, 'http://stand-in').searchParams) : answer[route] ? answer[route](body) : {}).then(found => { response.writeHead(200, headers); response.end(JSON.stringify(found)); });   // a case's answer may come late (page-replay.mjs answerFor _delayMs)
    });
  });
  if (stub) await new Promise(resolve => stub.listen(port, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-real-ext-'));
  let context, worker;
  try {
    launchGuard.check();   // a browser that did not start earlier in this process: stop now, never wait again per case (lib/launch-guard.mjs)
    context = await chromium.launchPersistentContext(profile, {
      ...browserChannel(), headless: false, locale: 'en-US', ...(timezoneId ? {timezoneId} : {}), ignoreDefaultArgs: ['--disable-extensions', '--disable-popup-blocking'], timeout: LAUNCH_TIMEOUT_MS,
      args: [...(process.env.E2E_HEADED ? [] : ['--headless=new']), `--disable-extensions-except=${copy}`, `--load-extension=${copy}`, '--no-first-run', '--no-default-browser-check', ...(cdp ? ['--remote-debugging-port=0'] : []),   // cdp: lib/replay-coverage.mjs reads <profile>/DevToolsActivePort
        // offline: a replay's pages come from routes; any host they do not serve resolves to nothing (11 Oct 2026: a route set while another tab loaded let one request out)
        ...(offline ? ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost'] : [])],
    });
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
  } catch (error) {
    launchGuard.failed(error);
    await context?.close().catch(() => {}); stub?.close();
    throw error;
  }
  await setExtensionStorage(worker, {workerUrl: `http://127.0.0.1:${port}`, token: 'e2e', ladderAct: true});   // ladderAct: the fill ladder's repair acts in test runs only (fake applicant; extension/ladder/fill-climb.js)
  const page = await context.newPage();
  const control = await context.newCDPSession(page);
  const close = async () => {
    try { await replayLimit('isolated browser.close', 3500, () => context.close()); }
    catch (error) {
      // Why (2026-10-27): a stuck context close must not leave its browser alive after the case deadline.
      await replayLimit('isolated browser force-close', 1000, () => control.send('Browser.close')).catch(() => {});
      throw error;
    } finally { stub?.closeAllConnections(); stub?.close(); }
  };

  // Fails the run unless the extension talks to the stand-in only (isolationProblem).
  const assertIsolated = async () => {
    const problem = isolationProblem(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), port);
    if (problem) throw new Error(problem);
    return true;
  };
  await assertIsolated().catch(async error => { await close(); throw error; });

  const panel = () => page.evaluate(() => {
    const root = document.getElementById('jobpilotto-review-host')?.shadowRoot;
    const text = selector => (root?.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
    return {buttons: [...(root?.querySelectorAll('button') || [])].map(button => (button.textContent || '').trim()).filter(Boolean), pill: text('.pill'), progress: text('.progress-line'), note: text('.note:not(.trace-note)')};
  });
  // What the app does for "Apply" (the same tab, marked for the extension), then the person's own click on the panel's Fill button.
  const fillWithPanel = async (tab = page) => {
    await tab.evaluate(() => { location.hash = 'jobpilotto-fill'; });
    await tab.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('button'), null, {timeout: 20000});
    await tab.waitForTimeout(3000);
    return tab.evaluate(() => {
      const buttons = [...(document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelectorAll('button') || [])].filter(button => !button.disabled);
      const pick = buttons.find(button => /^fill anyway$/i.test((button.textContent || '').trim())) || buttons.find(button => /^(fill this form|fill again)$/i.test((button.textContent || '').trim()));
      if (pick) pick.click();
      return pick ? pick.textContent.trim() : null;
    });
  };
  // Everything the extension sent the stand-in app whose body contains `text` (a field label, a reason): how a test proves a report left the extension.
  const told = text => requests.some(request => request.body.includes(text));
  const controlReports = () => requests.filter(request => request.route === '/extension/controls').map(request => { try { return JSON.parse(request.body); } catch { return null; } }).filter(Boolean);
  return {context, page, port, profile, requests, assertIsolated, panel, fillWithPanel, told, controlReports, close};
}

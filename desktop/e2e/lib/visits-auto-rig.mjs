// Job: wait on state
// Reaches: ../fixtures/visits/
// The rig for "Find jobs using your browser" (7 Oct 2026), shared by the visitsauto e2e suite and integration/extension/visits-auto.test.mjs: the REAL extension (a copy that talks to a
// stand-in app on a free port) in a real Chromium, fixture job lists served over HTTPS under two host names, the stand-in app counting each call. No Notion, no AI, no real site.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {browserChannel, copyExtension, freePort} from './extension.mjs';
import {extensionWorker} from './own-worker.mjs';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'visits');
export const ALLOWED = 'jobs.lever.co';         // a job-system host in the extension's host_permissions
export const OTHER = 'careers.example.ch';      // any other careers site: needs the one-time grant
const pause = ms => new Promise(done => setTimeout(done, ms));
/** Polls `check` every 250 ms for at most `ms` (a hang guard, not a pause) and returns true as soon as it answers truthy, false when the time is up; `check` may be async. @param {() => unknown} check @param {number} [ms] @returns {Promise<boolean>} */
export async function until(check, ms = 15000) { for (let waited = 0; waited < ms; waited += 250) { if (await check()) return true; await pause(250); } return false; }

// The app's side of the extension's calls: pairing, no recipe, no filters, each page read (its cards counted), and the done report.
function standInApp(port) {
  const calls = [];
  const jobs = new Map();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const payload = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
      if (req.method === 'POST') calls.push({path: req.url, payload});   // a CORS preflight (OPTIONS) is not a call
      const reply = data => { res.writeHead(200, {'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}); res.end(JSON.stringify(data)); };
      if (req.method === 'OPTIONS') { reply({}); return; }
      if (req.url === '/extension/pair') { reply({url: `http://127.0.0.1:${port}`, token: 'e2e-token'}); return; }
      if (req.url === '/extension/visit-read') {
        const seen = jobs.get(payload.session) || new Set();
        const before = seen.size;
        for (const card of payload.cards || []) seen.add(card.url);
        jobs.set(payload.session, seen);
        reply({ok: true, name: 'Fixture portal', jobs: seen.size, added: seen.size - before, kind: 'portal'});
        return;
      }
      if (req.url === '/extension/visit-recipe' || req.url === '/extension/visit-understand') { reply({ok: true, recipe: null}); return; }
      if (req.url === '/extension/visit-filters') { reply({ok: true, steps: [], why: ''}); return; }
      reply({ok: true});
    });
  });
  return {calls, server};
}


/**
 * Start the rig. The app's port is never the live app's (47111). @returns {Promise<{app: {calls: object[]}, context: import('playwright-core').BrowserContext, worker: object, reads: () => object[], close: () => Promise<void>}>}
 * Chrome's one-time "all sites" grant cannot be given from a script: a test that needs it stubs `chrome.permissions.contains` in `worker`.
 */
export async function startRig() {
  const certs = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-visits-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=jp-e2e', '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'cert.pem')], {stdio: 'ignore'});
  const sites = https.createServer({key: fs.readFileSync(path.join(certs, 'key.pem')), cert: fs.readFileSync(path.join(certs, 'cert.pem'))}, (req, res) => {
    const file = path.join(FIXTURES, path.basename(new URL(req.url, 'https://x').pathname));
    if (!fs.existsSync(file) || !file.endsWith('.html')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(fs.readFileSync(file));
  });
  await new Promise(done => sites.listen(0, '127.0.0.1', done));
  const appPort = await freePort();
  if (appPort === 47111) throw new Error('the test app must not use the live app\'s port');
  const app = standInApp(appPort);
  await new Promise(done => app.server.listen(appPort, '127.0.0.1', done));
  const extensionDir = copyExtension(appPort);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-visits-chromium-'));
  const rules = [`MAP ${ALLOWED} 127.0.0.1:${sites.address().port}`, `MAP ${OTHER} 127.0.0.1:${sites.address().port}`, 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost'].join(', ');
  const context = await chromium.launchPersistentContext(profile, {
    ...browserChannel(), headless: false, ignoreHTTPSErrors: true, ignoreDefaultArgs: ['--disable-extensions', '--disable-popup-blocking'],
    args: [...(process.env.E2E_HEADED ? [] : ['--headless=new']), `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`,
      `--host-resolver-rules=${rules}`, '--ignore-certificate-errors', '--no-first-run', '--no-default-browser-check'],
  });
  const close = async () => { await context.close().catch(() => {}); app.server.close(); sites.close(); };
  try {
    const worker = await extensionWorker(context);
    return {app, appPort, context, worker, reads: () => app.calls.filter(call => call.path === '/extension/visit-read'), close};
  } catch (error) { await close(); throw error; }
}

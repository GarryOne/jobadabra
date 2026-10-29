// A real isolated extension throws and rejects through the existing log channel into the app's SDK-free reporter; every request stays local.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {copyExtension, freePort, launchBrowser} from '../lib/extension.mjs';
import {cleanEntries} from '../../../worker/src/extension-log.js';   // not extension.js: it imports the AI SDK, which the desktop CI job does not install
import {createWatcher} from '../../lib/real-errors.js';
import {create} from '../../lib/sentry.js';
import {create as telemetry, reportingOff} from '../../lib/telemetry.js';
import {causedByPlant} from '../../lib/planted.js';
import {markPlanted} from '../lib/planted.mjs';

async function until(check) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('the extension did not deliver its error within 8 seconds');
}

async function exercise(start) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-extension-sentry-'));
  const port = await freePort(), sent = [], logged = [], captures = [];
  let on = true, packaged = true, time = 100_000;
  const reports = telemetry({settings: () => ({telemetry: on})});
  const client = create({dsn: `http://key@127.0.0.1:${port}/1`, release: 'job-pilotto@test', installId: 'isolated-install', now: () => time,
    enabled: () => !reportingOff({}, {packaged}) && reports.enabled(),
    fetcher: async (url, init) => {
      assert.equal(new URL(url).host, `127.0.0.1:${port}`);
      sent.push(init.body);
      return {ok: true};
    }});
  const watch = createWatcher({sentry: (kind, fields) => { captures.push({kind, ...fields}); return client.capture(kind, fields); }});
  const app = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    // The route's own cleaning (worker/src/extension.js, /extension/log) with the real field whitelist; the route file itself needs the worker's packages.
    const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type'};
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }   // the browser's preflight, as handleExtension answers it
    const authorised = req.headers.authorization === 'Bearer isolated-token';
    let response;
    if (req.url === '/extension/log' && authorised) {
      const {entries} = JSON.parse(body || '{}');
      const clean = cleanEntries(entries);
      logged.push(...clean);
      watch(clean);
      response = Response.json({ok: true, kept: clean.length});
    } else response = Response.json(req.url === '/extension/pair' ? {url: `http://127.0.0.1:${port}`, token: 'isolated-token'} : {}, {status: req.url === '/extension/log' ? 401 : 200});
    res.writeHead(response.status, {...cors, ...Object.fromEntries(response.headers)});
    res.end(await response.text());
  });
  await new Promise(resolve => app.listen(port, '127.0.0.1', resolve));
  const extensionDir = copyExtension(port, undefined, path.join(root, 'extension'));
  const spool = path.join(root, 'spool');
  fs.mkdirSync(spool);
  fs.writeFileSync(path.join(extensionDir, 'sentry-plant.js'), `// Synthetic failures in this test extension only, never a job page.
export function plant(reject) {
  const error = new TypeError('PAGE_TEXT_CANARY https://private.example/URL_CANARY');
  if (reject) { void Promise.reject(error); return; }
  setTimeout(() => { throw error; }, 0);
}
globalThis.plantSentry = plant;   // a service worker cannot import() dynamically; log.js imports this file statically
`);
  fs.appendFileSync(path.join(extensionDir, 'log.js'), "\nimport './sentry-plant.js';\n");
  let browser;
  try {
    browser = await start({port, spool, extensionDir});
    const plant = async rejection => {
      const count = logged.filter(item => item.kind === 'error').length;
      await browser.plant(rejection);
      await until(() => logged.filter(item => item.kind === 'error').length > count);
    };
    await plant(false);
    assert.equal(sent.length, 1);
    const event = JSON.parse(sent[0].split('\n')[2]);
    assert.equal(event.tags.source, 'extension');
    assert.equal(event.exception.values[0].type, 'TypeError');
    assert.ok(event.exception.values[0].stacktrace.frames.some(frame => frame.filename === 'sentry-plant.js' && frame.lineno === 3));
    assert.ok(event.tags.extVersion);
    assert.equal(event.release, 'job-pilotto@test');
    assert.equal(event.user.id, 'isolated-install');
    await plant(false);
    assert.equal(sent.length, 1, 'a repeated error is held');
    time += 60_000;
    await plant(false);
    assert.equal(sent.length, 2, 'a minute later it may report again');
    await plant(true);
    assert.equal(sent.length, 3, 'an unhandled rejection is also reported');
    assert.equal(JSON.parse(sent[2].split('\n')[2]).exception.values[0].type, 'TypeError');
    on = false;
    time += 60_000;
    await plant(false);
    assert.equal(sent.length, 3, 'reports off');
    on = true; packaged = false;
    await plant(false);
    assert.equal(sent.length, 3, 'a development build');
    const local = await browser.local();
    assert.ok(local.filter(entry => entry.kind === 'error').length >= 6, 'local logging remains on');
    assert.doesNotMatch(sent.join(''), /PAGE_TEXT_CANARY|URL_CANARY|private\.example|chrome-extension:\/\//);
    assert.deepEqual([...browser.requested].filter(host => host !== '127.0.0.1'), [], 'only localhost was requested');
    const captured = captures[0];
    const env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_PLANTED_FILE: path.join(root, 'planted.log')};
    markPlanted('extension exception', {kinds: ['extension_error'], source: 'extension', frame: 'sentry-plant.js:3:'}, env, time);
    assert.equal(causedByPlant(captured, env, time), true);
    assert.equal(causedByPlant({...captured, stack: 'at fill.js:3:1'}, env, time), false);
  } finally {
    await browser?.close();
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(root, {recursive: true, force: true});
  }
}

test('real worker errors and rejections report safe frames, obey both gates and deduplicate', {timeout: 45000}, async () => {
  await exercise(async options => {
    const browser = await launchBrowser(options);
    try {
      const worker = await browser.serviceWorker();
      await worker.evaluate(async port => {
        await globalThis.chrome.storage.local.set({workerUrl: `http://127.0.0.1:${port}`, token: 'isolated-token'});
      }, options.port);
      return {close: browser.close, requested: browser.requested,
        plant: rejection => worker.evaluate(async ([reject, port]) => {   // paired again just before: the worker's boot sweep may have dropped the pairing
          await globalThis.chrome.storage.local.set({workerUrl: `http://127.0.0.1:${port}`, token: 'isolated-token'});
          globalThis.plantSentry(reject);
        }, [rejection, options.port]),
        local: () => worker.evaluate(async () => (await globalThis.chrome.storage.local.get('jp-decisions'))['jp-decisions'] || [])};   // read the stored log: import() is not allowed in a service worker
    } catch (error) { await browser.close(); throw error; }
  });
});

test('mock worker runtime: real log module, authenticated channel and app reporter', async () => {
  await exercise(async ({port, extensionDir}) => {
    // The harness copy keeps the live app unreachable; mock only Chrome's event and storage APIs, never the log or reporting code.
    fs.writeFileSync(path.join(extensionDir, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(extensionDir, 'flow.js'), 'export async function settings() { return chrome.storage.local.get(["workerUrl", "token"]); }');
    const previous = {self: globalThis.self, chrome: globalThis.chrome, fetch: globalThis.fetch};
    const listeners = new Map(), requested = new Set();
    let stored = {workerUrl: `http://127.0.0.1:${port}`, token: 'isolated-token'};
    const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
    globalThis.self = {addEventListener: (name, fn) => listeners.set(name, fn)};
    globalThis.chrome = {runtime: {getURL: () => origin, getManifest: () => ({version: '0.9.123'})}, storage: {local: {
      get: async () => structuredClone(stored), set: async value => { stored = {...stored, ...structuredClone(value)}; },
    }}};
    globalThis.fetch = (url, init) => {
      const target = new URL(url);
      assert.equal(target.host, `127.0.0.1:${port}`, 'no request may reach the live app or the internet');
      requested.add(target.hostname);
      return previous.fetch(url, init);
    };
    const close = async () => { Object.assign(globalThis, previous); };
    try {
      const log = await import(pathToFileURL(path.join(extensionDir, 'log.js')));
      return {close, requested, local: log.decisions, plant: async rejection => {
        const error = new TypeError('PAGE_TEXT_CANARY https://private.example/URL_CANARY');
        error.stack = `${error}\n at arbitrary (${origin}sentry-plant.js:3:17)`;
        listeners.get(rejection ? 'unhandledrejection' : 'error')(rejection ? {reason: error} : {error});
      }};
    } catch (error) { await close(); throw error; }
  });
});

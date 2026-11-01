// A live row without Electron (lib/live-row.mjs), on an invented site and memo-only (the AI never asked): the app's own Apply opens the posting in the harness
// browser with the fill mark, the extension asks what the page is, the app notes the ask, the journey is captured, the tripwire finds nothing of the owner's.
// Opt-in like every browser run (JP_REPLAY=1); under the heavy lock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {startAiProxy} from '../../lib/ai-proxy.mjs';
import {seedVersion} from '../../lib/applicant-seed.mjs';
import {runLiveRow} from '../../lib/live-row.mjs';
import {startRealExtension} from '../../lib/real-extension.mjs';

const skip = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1; it starts Chromium with the real extension';
const PAGES = {
  'https://jobs.example.org/job/42': '<!doctype html><title>Engineer</title><main><h1>Site Reliability Engineer</h1><p>Join us.</p><a href="https://jobs.example.org/job/42/apply">Apply now</a></main>',
  'https://jobs.example.org/job/42/apply': '<!doctype html><title>Apply</title><main><h1>Your application</h1><form><label for="f">First name</label><input id="f" required><label for="e">Email</label><input id="e" type="email" required></form></main>',
};
// The site, served to the test browser (offline otherwise): one route before any page loads.
const fakeSite = async options => {
  const run = await startRealExtension({...options, offline: true});
  await run.context.route('**/*', route => {
    const url = route.request().url().replace(/[?#].*$/, '');
    if (url.startsWith('http://127.0.0.1')) return route.continue();
    return PAGES[url] ? route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: PAGES[url]}) : route.fulfill({status: 404, body: ''});
  });
  return run;
};

test('a live row runs on the app\'s own path without Electron: Apply opens the posting, the extension asks, the journey is kept', {skip}, async () => {
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-live-row-'));
  const result = await runLiveRow({posting: {url: 'https://jobs.example.org/job/42', title: 'Engineer', company: 'Example'}, captureDir, ask: false, seconds: 50, stillSeconds: 8, browser: fakeSite});
  assert.equal(result.tripped, '');
  assert.match(result.opened, /^https:\/\/jobs\.example\.org\/job\/42\/?#jobpilotto-fill=[A-Za-z0-9_-]+$/);
  assert.ok(result.evidence.pageKind.length >= 1, `the extension asked what the page is: ${JSON.stringify(result.evidence)}`);
  assert.ok(fs.existsSync(path.join(captureDir, 'asks.jsonl')), 'the app noted the ask as it arrived');
  const journey = JSON.parse(fs.readFileSync(path.join(captureDir, 'journey.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(captureDir, 'case.json')) && fs.existsSync(path.join(captureDir, 'presses.json')), 'a row a replay can start from');
  assert.equal(JSON.parse(fs.readFileSync(path.join(captureDir, 'case.json'), 'utf8')).seed, seedVersion(), 'the capture records the applicant seed it ran with (lib/applicant-seed.mjs)');
  assert.ok(journey.some(page => page.url.startsWith('https://jobs.example.org/job/42') && page.ask), JSON.stringify(journey.map(page => [page.url, page.ask])));
});

// The pool on a CI runner (.github/workflows/record-sites.yml): the app asks through its API engine and the harness's metering proxy, and the row reports its spend
// (lib/record-sites.mjs parseLive reads it for the dollar cap). Here the proxy answers itself (canned, the placeholder key): nothing is paid, so the spend is 0.
test('a live row with an AI proxy asks through it from the real extension and reports its spend', {skip}, async () => {
  const proxy = await startAiProxy();
  proxy.setCanned(() => JSON.stringify({kind: 'posting', confidence: 0.9, apply_button: 'Apply now', apply_button_kind: 'apply', apply_route: '', apply_by: 'form', apply_email: '',
    form_frame: -1, account_step: '', register_control: '', signin_control: '', account_button: '', bot_check: false}));
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-live-row-proxy-'));
  try {
    const result = await runLiveRow({posting: {url: 'https://jobs.example.org/job/42', title: 'Engineer', company: 'Example'}, captureDir, ask: true, seconds: 50, stillSeconds: 8, browser: fakeSite, aiProxy: proxy});
    assert.equal(result.tripped, '');
    assert.ok(proxy.stats.canned >= 1, `the extension's page-kind ask went through the proxy: ${JSON.stringify(proxy.stats)}`);
    assert.deepEqual(result.ai, {calls: 0, usd: 0, input: 0, output: 0, refused: 0, why: ''}, 'the spend is reported (canned answers cost nothing, none refused)');
  } finally { await proxy.close(); }
});

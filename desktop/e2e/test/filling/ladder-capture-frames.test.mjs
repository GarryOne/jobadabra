// ladder-capture.mjs lists frame candidates the way the extension does (rung3-frames.js + climb.js frameSketch, never a copy) and waits for a growing frame to qualify;
// a frame that never qualifies is recorded as such (a finding), a page with no other host's iframe does not wait. Headless Chromium, network blocked; skipped without Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const e2e = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..');
let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

test('the capture reads frames with the extension\'s own code, never a copy', () => {
  const source = fs.readFileSync(path.join(e2e, 'ladder-capture.mjs'), 'utf8');
  assert.match(source, /import \{frameSketch\} from '\.\.\/\.\.\/extension\/ladder\/climb\.js'/);
  assert.match(source, /'extension\/ladder\/rung3-frames\.js'/);
  assert.ok(!/getBoundingClientRect|300|200\)/.test(source.slice(source.indexOf('frameCandidatesOfPage'), source.indexOf('export async function grownFramesOf'))), 'no frame floor of its own');
});

test('a growing frame is waited for; one that never qualifies is a recorded finding; no foreign iframe, no wait', {skip: !chromium && 'no Chromium installed'}, async () => {
  const {grownFramesOf} = await import('../../ladder-capture.mjs');
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const page = await context.newPage();
    await page.route(() => true, route => (route.request().url().startsWith('https://jobs.example.test/') ? route.fulfill({contentType: 'text/html', body: ''}) : route.abort()));
    const at = async body => { await page.goto('https://jobs.example.test/'); await page.setContent(`<!doctype html><html><body><h1>Job</h1>${body}</body></html>`); };

    await at('<iframe src="https://boards.example.net/embed/job_app?token=x" style="border:0;width:650px;height:150px"></iframe><script>setTimeout(() => { document.querySelector("iframe").style.height = "2400px"; }, 1200)</script>');
    const grown = await grownFramesOf(page, {waitMs: 6000, stepMs: 200});
    assert.deepEqual(grown.frameCandidates, [{host: 'boards.example.net', path: '/embed/job_app', width: 650, height: 2400}], 'host, path and size only: no address, no query');
    assert.equal(grown.frame.qualified, true);
    assert.ok(grown.frame.after_s >= 1, 'it waited for the frame to grow');

    await at('<iframe src="https://boards.example.net/embed/job_app" style="border:0;width:650px;height:150px"></iframe>');
    const small = await grownFramesOf(page, {waitMs: 1000, stepMs: 200});
    assert.deepEqual([small.frameCandidates, small.frame.qualified], [[], false]);

    await at('<p>No frame here.</p>');
    assert.deepEqual(await grownFramesOf(page, {waitMs: 5000}), {frameCandidates: [], frame: null});
  } finally { await browser.close(); }
});

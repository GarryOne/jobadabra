/* global document, location, window, performance */
// One Apply is one piece of work: from "Reading this page" on the posting to the fill's end, through every page change, the page stays dimmed and the panel stays centred and working,
// and the finished look ("Fill again") is never drawn mid-run (real extension, fixture pages, fake data). Owner, 27 Oct 2026, from a screen recording of an Apply on a posting:
// "the extension panel and dark/glow background appears and disappears... moves from center to bottom-left and center again several times".
// Cause: every new document (the posting's page change to the form, a second load of it) started with no dim and no panel until the panel's scripts loaded and asked for the step;
// early-dim.js dimmed only an address with the fill mark, which a page change drops. Guard for: extension/early-dim.js, review.js (first draw waits for the step).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const POSTING = '<!doctype html><title>ML Engineer</title><body><h1>ML Engineer</h1><p>Company background and project description.</p><a href="https://jobs.example.test/form">Apply</a><script>if (location.pathname === \'/post\') setTimeout(() => location.replace(\'/post2\'), 500);</script>';
const FORM = '<!doctype html><title>Apply</title><body><form><h1>Apply</h1><label>Full name <input name="n" required></label><label>Email <input name="e" type="email" required></label><label>Phone <input name="p" required></label><label>City <input name="c" required></label></form>';
const SETTLE_MS = 40;   // a new document is given this long to show its look (the worker's dim runs at the page's commit); the owner's recording shows gaps of 60 ms to seconds

// Every document samples its own look every 5 ms from its first moment and hands it to the test (an exposed function survives page changes).
const SAMPLER = () => {
  const born = performance.now(), doc = Math.round(performance.timeOrigin + born);
  const sample = () => { try {
    const h = document.getElementById('jobpilotto-review-host'), root = h?.shadowRoot, fill = document.documentElement.dataset.jobpilottoFill || '';
    window.__rec({doc, path: location.pathname, age: Math.round(performance.now() - born), dim: !!document.getElementById('jobpilotto-fill-overlay'), host: !!h,
      centred: !!h && /translate/.test(h.style.cssText), busy: !!root?.querySelector('.fill.is-busy'), label: root?.querySelector('.fill .label')?.textContent || '',
      over: /"state":"(done|error|no-form|account)"/.test(fill)}); } catch { /* no document element or no binding yet */ } };
  sample(); setInterval(sample, 5);
};

test('an Apply from the posting to the fill\'s end keeps the dim, the centred panel and the working look at every sample, through each page change', async () => {
  const app = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true});
  const samples = [];
  try {
    await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: /\/form/.test(route.request().url()) ? FORM : POSTING}));
    await app.page.exposeFunction('__rec', sample => { samples.push(sample); });
    await app.page.addInitScript(SAMPLER);
    await app.page.goto('https://jobs.example.test/post#jobpilotto-fill');   // the app opens the posting with the fill mark
    await app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.fill.is-busy'), null, {timeout: 20000});
    await app.page.waitForTimeout(800);
    await app.page.evaluate(() => { location.href = 'https://jobs.example.test/form'; });   // the Apply press: a page change, its address carries no mark
    await app.page.waitForFunction(() => /"state":"(done|error|no-form|account)"/.test(document.documentElement.dataset.jobpilottoFill || ''), null, {timeout: 60000}).catch(() => {});
    await app.page.waitForTimeout(300);
  } finally { await app.close(); }
  const docs = [...new Set(samples.map(s => s.doc))];
  assert.ok(docs.length >= 2, `positive control: the run went through a page change (${docs.length} documents)`);
  const during = samples.filter(s => !s.over && s.age >= SETTLE_MS);
  assert.ok(during.length >= 100, `positive control: the run was sampled (${during.length} samples)`);
  const show = bad => JSON.stringify(bad.slice(0, 3));
  const undimmed = during.filter(s => !s.dim);
  assert.equal(undimmed.length, 0, `the dim was off for ${undimmed.length} sample(s) mid-run (document ${undimmed[0]?.path}, ${undimmed[0]?.age} ms in): ${show(undimmed)}`);
  const cornered = during.filter(s => s.host && !s.centred);
  assert.equal(cornered.length, 0, `the panel left the centre ${cornered.length} sample(s) mid-run: ${show(cornered)}`);
  const finished = during.filter(s => s.host && (!s.busy || s.label === 'Fill again'));
  assert.equal(finished.length, 0, `the finished look ("Fill again", no step) was drawn ${finished.length} sample(s) mid-run: ${show(finished)}`);
  const missing = during.filter(s => !s.host && s.age >= 1500);
  assert.equal(missing.length, 0, `the panel was absent after 1.5 s on a page of the run: ${show(missing)}`);
});

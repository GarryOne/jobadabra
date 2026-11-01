/* global document, location, window, performance, chrome */
// One Apply is one piece of work: from "Reading this page" on the posting to the fill's end, through every page change, the page stays dimmed and the panel stays centred and working,
// and the finished look ("Fill again") is never drawn mid-run (real extension, fixture pages, fake data). Owner, 27 Oct 2026, from a screen recording of an Apply on a posting:
// "the extension panel and dark/glow background appears and disappears... moves from center to bottom-left and center again several times".
// Cause: every new document (the posting's page change to the form, a second load of it) started with no dim and no panel until the panel's scripts loaded and asked for the step;
// early-dim.js dimmed only an address with the fill mark, which a page change drops. Guard for: extension/early-dim.js, review.js (first draw waits for the step).
// Strict since 1 Nov 2026 (a8, GitHub issue #2800): the run is the worker's own states, not a time window. The worker logs every apply:<tab> change (chrome.storage.session); the run must be
// exactly working -> one verdict (no `done` in between), and between the start verdict and the end verdict a document that has shown its look never loses it. No settle time, no tolerance.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../../e2e/lib/real-extension.mjs';
import {extensionWorker} from '../../e2e/lib/own-worker.mjs';

const POSTING = '<!doctype html><title>ML Engineer</title><body><h1>ML Engineer</h1><p>Company background and project description.</p><a href="https://jobs.example.test/form">Apply</a><script>if (location.pathname === \'/post\') setTimeout(() => location.replace(\'/post2\'), 500);</script>';
const FORM = '<!doctype html><title>Apply</title><body><form><h1>Apply</h1><label>Full name <input name="n" required></label><label>Email <input name="e" type="email" required></label><label>Phone <input name="p" required></label><label>City <input name="c" required></label></form>';

// Every document samples its own look every 5 ms from its first moment and hands it to the test (an exposed function survives page changes).
const SAMPLER = () => {
  const born = performance.now(), doc = Math.round(performance.timeOrigin + born);
  const sample = () => { try {
    const h = document.getElementById('jobpilotto-review-host'), root = h?.shadowRoot;
    window.__rec({doc, path: location.pathname, at: Math.round(performance.timeOrigin + performance.now()), dim: !!document.getElementById('jobpilotto-fill-overlay'), host: !!h,
      centred: !!h && /translate/.test(h.style.cssText), busy: !!root?.querySelector('.fill.is-busy'), label: root?.querySelector('.fill .label')?.textContent || ''}); } catch { /* no document element or no binding yet */ } };
  sample(); setInterval(sample, 5);
};

// The worker keeps every change of a tab's Apply state with the moment it happened (apply-state.js writes apply:<tab> to chrome.storage.session on each change).
const LOG_STATES = () => {
  globalThis.__applyLog = [];
  chrome.storage.session.onChanged.addListener(changes => {
    for (const [key, change] of Object.entries(changes)) if (key.startsWith('apply:')) globalThis.__applyLog.push({at: Date.now(), key, state: change.newValue || ''});
  });
};

test('an Apply from the posting to the fill\'s end is working then one verdict, and every document keeps its look from the first moment it showed it until that verdict', async () => {
  const app = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true});
  const samples = [];
  let states = [];
  try {
    const worker = await extensionWorker(app.context);
    await worker.evaluate(LOG_STATES);
    await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: /\/form/.test(route.request().url()) ? FORM : POSTING}));
    await app.page.exposeFunction('__rec', sample => { samples.push(sample); });
    await app.page.addInitScript(SAMPLER);
    await app.page.goto('https://jobs.example.test/post#jobpilotto-fill');   // the app opens the posting with the fill mark
    await app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.fill.is-busy') && document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 20000});
    await app.page.evaluate(() => { location.href = 'https://jobs.example.test/form'; });   // the Apply press: a page change, its address carries no mark
    // The fill writes its own end on the page a few ms after the worker's verdict (so the worker's log is complete once it shows); the hang guard names the states the worker went through.
    await app.page.waitForFunction(() => /"state":"(done|error|no-form|account)"/.test(document.documentElement.dataset.jobpilottoFill || ''), null, {timeout: 60000})
      .catch(async error => assert.fail(`the fill never wrote its end on the page: ${error.message}; the worker's states: ${JSON.stringify(await worker.evaluate(() => globalThis.__applyLog))}`));
    states = await worker.evaluate(() => globalThis.__applyLog);
  } finally { await app.close(); }
  assert.deepEqual(judgeRun(states, samples), [], 'the Apply broke its one-piece look (issue #2800)');
});

/**
 * The verdicts about one recorded run. -> the list of what is wrong (empty when the run is clean).
 * @param {{at: number, state: string}[]} states the worker's apply:<tab> changes, in order
 * @param {{doc: number, path: string, at: number, dim: boolean, host: boolean, centred: boolean, busy: boolean, label: string}[]} samples every document's samples
 */
export function judgeRun(states, samples) {
  const problems = [];
  const docs = [...new Set(samples.map(s => s.doc))];
  if (docs.length < 2) problems.push(`positive control: the run went through a page change (${docs.length} documents)`);
  if (states[0]?.state !== 'working') problems.push(`positive control: the run started working; states: ${JSON.stringify(states)}`);
  // The run is one piece of work: working, then exactly one verdict. A `done` followed by `working` again is the glitch of issue #2800 (the page shows "Fill again" in between).
  if (states.length !== 2) problems.push(`the Apply must be working then one verdict, got ${JSON.stringify(states.map(s => s.state))} at ${JSON.stringify(states.map(s => s.at))}`);
  if (!states.length) return problems;
  const startAt = states[0].at, endAt = states.at(-1).at, show = bad => JSON.stringify(bad.slice(0, 3));
  // Per document: from the first sample that shows the complete look (dim, panel centred and busy) to the end verdict, nothing may be missing. What a document shows before that (its first moments) is not judged here.
  const during = [];
  for (const doc of docs) {
    const mine = samples.filter(s => s.doc === doc && s.at >= startAt && s.at < endAt);
    const first = mine.findIndex(s => s.dim && s.host && s.centred && s.busy);
    if (first >= 0) during.push(...mine.slice(first));
  }
  if (during.length < 100) problems.push(`positive control: the run was sampled (${during.length} samples after each document showed its look)`);
  const undimmed = during.filter(s => !s.dim);
  if (undimmed.length) problems.push(`the dim was off for ${undimmed.length} sample(s) between the start and the end verdict (document ${undimmed[0].path}): ${show(undimmed)}`);
  const cornered = during.filter(s => s.host && !s.centred);
  if (cornered.length) problems.push(`the panel left the centre ${cornered.length} sample(s) mid-run: ${show(cornered)}`);
  const finished = during.filter(s => s.host && (!s.busy || s.label === 'Fill again'));
  if (finished.length) problems.push(`the finished look ("Fill again", no step) was drawn ${finished.length} sample(s) mid-run: ${show(finished)}`);
  const missing = during.filter(s => !s.host);
  if (missing.length) problems.push(`the panel was absent ${missing.length} sample(s) after it first showed: ${show(missing)}`);
  return problems;
}

// The verdicts, played on recorded-shape data (a clean run, then each way the owner's glitch shows): the browser test above only has to record, these say what is wrong.
const look = (doc, at, over = {}) => ({doc, path: '/form', at, dim: true, host: true, centred: true, busy: true, label: 'Filling', ...over});
const clean = () => Array.from({length: 150}, (_, i) => look(1, 1000 + i * 5));
const RUN = [{at: 1000, state: 'working'}, {at: 1900, state: 'done'}];
const TWO_DOCS = () => [...clean(), ...Array.from({length: 50}, (_, i) => look(2, 1100 + i * 5))];

test('a clean run (working, one verdict, the look kept) has nothing wrong', () => {
  assert.deepEqual(judgeRun(RUN, TWO_DOCS()), []);
});

test('a done in the middle of the run is the glitch of issue #2800, even when the look comes back', () => {
  const states = [{at: 1000, state: 'working'}, {at: 1300, state: 'done'}, {at: 1600, state: 'working'}, {at: 1900, state: 'done'}];
  assert.match(judgeRun(states, TWO_DOCS()).join('\n'), /working then one verdict, got \["working","done","working","done"\]/);
});

test('the dim off for one sample between the verdicts is reported with no tolerance', () => {
  const samples = TWO_DOCS();
  samples[80] = {...samples[80], dim: false};
  assert.match(judgeRun(RUN, samples).join('\n'), /the dim was off for 1 sample/);
});

test('"Fill again" drawn mid-run and a panel that left the centre are reported', () => {
  const samples = TWO_DOCS();
  samples[60] = {...samples[60], busy: false, label: 'Fill again', dim: false, centred: false};
  const text = judgeRun(RUN, samples).join('\n');
  assert.match(text, /the finished look \("Fill again"/);
  assert.match(text, /the panel left the centre 1 sample/);
});

test('a run that was never sampled fails its positive control', () => {
  assert.match(judgeRun(RUN, []).join('\n'), /positive control: the run went through a page change/);
});

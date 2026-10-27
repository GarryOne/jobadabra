/* global document, location, window, performance, chrome */
// An Apply whose posting document is replaced once in its first half second, before the worker has the fill's first step: the dim and the centred panel never drop (real extension, fixture page, fake data).
// Owner, 27 Oct 2026, second recording after #2262 (Greenhouse posting): dimmed + centred at 2.2 s, then dim and panel gone for 0.4 s, the panel back centred on an undimmed page, then in the
// bottom-right corner in the finished look, then dimmed and centred for good. Guard for: extension/early-dim.js, extension/background.js (the tab is "in an Apply" from the app's open), review.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

// Two ways a posting replaces its own document at once: a reload (the mark stays in the address) and a script that moves to the same page without the mark (a redirect through the site's own router).
const POSTING = how => `<!doctype html><title>ML Engineer</title><body><h1>ML Engineer</h1><p>Company background and project description.</p><script>if (!sessionStorage.once) { sessionStorage.once = '1'; setTimeout(() => { ${how} }, 350); }</script>`;
const SETTLE_MS = 400;   // a new document is given this long to show its look: the worker injects the dim at the page's commit (16-30 ms measured idle, 300 ms on a Mac at load 60); no later gap is allowed

// Every document samples its own look every 5 ms from its first moment (same sampler as fill-overlay-run.test.mjs).
const SAMPLER = () => {
  const born = performance.now(), doc = Math.round(performance.timeOrigin + born);
  const sample = () => { try {
    const h = document.getElementById('jobpilotto-review-host'), root = h?.shadowRoot, fill = document.documentElement.dataset.jobpilottoFill || '';
    window.__rec({doc, path: location.pathname, age: Math.round(performance.now() - born), dim: !!document.getElementById('jobpilotto-fill-overlay'), host: !!h,
      centred: !!h && /translate/.test(h.style.cssText), busy: !!root?.querySelector('.fill.is-busy'), label: root?.querySelector('.fill .label')?.textContent || '',
      over: /"state":"(done|error|no-form|account)"/.test(fill)}); } catch { /* no document element or no binding yet */ } };
  sample(); setInterval(sample, 5);
};

// The third is the owner's recording: the page's framework re-renders the whole document at hydration and drops every element it did not draw, ours included (the dim layer and the panel are children of <html>).
const WIPE = `[...document.documentElement.children].forEach(el => { if (!/^(HEAD|BODY)$/.test(el.tagName)) el.remove(); })`;
for (const [name, how] of [['reload (mark kept)', 'location.reload()'], ['same page without the mark', 'location.replace(location.pathname)'], ['the page drops what it did not draw', WIPE]]) {
  test(`an Apply whose posting is replaced at once (${name}) stays dimmed, centred and working at every sample`, async () => {
    const app = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true});
    const samples = [];
    try {
      await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: POSTING(how)}));
      await app.page.exposeFunction('__rec', sample => { samples.push(sample); });
      await app.page.addInitScript(SAMPLER);
      await app.page.goto('https://jobs.example.test/post#jobpilotto-fill');   // the app opens the posting with the fill mark
      await app.page.waitForTimeout(4000);
    } finally { await app.close(); }
    const docs = [...new Set(samples.map(s => s.doc))];
    assert.ok(docs.length >= 2 || how === WIPE, `positive control: the posting's document was replaced (${docs.length} documents)`);
    if (how === WIPE) assert.ok(samples.some(s => s.age > 600), 'positive control: the page was sampled past its re-render');
    const endAt = samples.findLastIndex(s => s.dim);   // the run ends on the worker's verdict (a few ms before the page's own end note): every sample before the last dimmed one is mid-run
    const during = samples.filter((s, i) => i < endAt && !s.over && s.age >= SETTLE_MS);
    assert.ok(during.length >= 100, `positive control: the run was sampled (${during.length} samples)`);
    const show = bad => JSON.stringify(bad.slice(0, 3));
    const undimmed = during.filter(s => !s.dim);
    assert.equal(undimmed.length, 0, `the dim was off for ${undimmed.length} sample(s) (document ${undimmed[0]?.doc}, ${undimmed[0]?.age} ms in): ${show(undimmed)}`);
    const cornered = during.filter(s => s.host && !s.centred);
    assert.equal(cornered.length, 0, `the panel left the centre ${cornered.length} sample(s): ${show(cornered)}`);
    const finished = during.filter(s => s.host && (!s.busy || s.label === 'Fill again'));
    assert.equal(finished.length, 0, `the finished look was drawn ${finished.length} sample(s): ${show(finished)}`);
  });
}

// Each verdict of the worker lifts the dim and the centred panel, and nothing brings either back (owner, 27 Oct 2026: "Done, Stop, or your turn. Nothing else"). The verdict is pushed from the worker the way
// extension/apply-state.js does; the run's own end (done) is covered by fill-overlay-run.test.mjs, Stop's and the person's turn by the senders asserted in desktop/test/apply-state-owner.test.js.
for (const state of ['done', 'stopped', 'your-turn']) {
  test(`the worker's verdict "${state}" lifts the dim and the centred panel for good`, async () => {
    const app = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true});
    const samples = [];
    try {
      await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>ML Engineer</title><body><h1>ML Engineer</h1>'}));
      await app.page.exposeFunction('__rec', sample => { samples.push(sample); });
      await app.page.addInitScript(SAMPLER);
      await app.page.goto('https://jobs.example.test/post#jobpilotto-fill');
      await app.page.waitForFunction(() => document.getElementById('jobpilotto-fill-overlay') && document.getElementById('jobpilotto-review-host'), null, {timeout: 20000});
      await app.context.serviceWorkers()[0].evaluate(async verdict => {
        const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'});
        await chrome.tabs.sendMessage(tab.id, {type: 'applyState', state: verdict});
      }, state);
      await app.page.waitForTimeout(1500);
    } finally { await app.close(); }
    const lifted = samples.findIndex((s, i) => i > 0 && samples[i - 1].dim && !s.dim);
    assert.ok(lifted > 0, `positive control: the dim was on, then lifted by "${state}"`);
    const after = samples.slice(lifted);
    assert.equal(after.filter(s => s.dim).length, 0, `the dim came back after "${state}"`);
    assert.equal(after.filter(s => s.host && s.centred).length, 0, `the panel stayed or went back to the centre after "${state}"`);
  });
}

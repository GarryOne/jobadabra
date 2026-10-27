/* global document */
// The form panel draws no CV row and no "Tailor in Jobadabra" (owner, 27 Oct 2026: "let's remove the line with "general CV attached… Tailor in Jobadabra". And let's have the "Open in Jobadabra" centered"):
// the app tailors and restarts the form when the CV is ready (desktop/lib/tailored-restart.js). Open in Jobadabra is centred, and its failure is said on the panel.
// Real extension on a fixture form, a stand-in app with fake data, no paid AI, nothing live (owner, 19 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const FORM = `<!doctype html><title>Senior Site Reliability Engineer</title><form><h1>Apply</h1>
<label>Full name <input name="n" required></label><label>Email <input name="e" type="email" required></label><label>Phone <input name="p" required></label><label>City <input name="c" required></label></form>`;
const URL = 'https://jobs.example.test/apply';

// The stand-in app. cv: what the real app's cvOf says (tailored already, being tailored in the window); silent: /extension/open refuses.
async function start({cv = {tailored: false, working: false}, silent = false} = {}) {
  const app = {opened: [], events: [], cv};
  const answer = {
    '/extension/kit': () => ({job: {code: 'J1', title: 'Senior SRE', company: 'Example'}, kit: {answers: []}}),
    '/extension/review': () => ({matched: 's1', session: {id: 's1', url: URL, status: 'running', stuck: false}, watch: [], commands: [], theme: 'light', cv: app.cv}),
    '/extension/open': body => { app.opened.push(JSON.parse(body || '{}')); return {ok: !silent}; },
    '/extension/event': body => { app.events.push(JSON.parse(body || '{}').type); return {ok: true}; }};
  const real = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true, answer});
  await real.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: FORM}));
  await real.page.goto(`${URL}#jobpilotto-fill`);   // the app opens the tab with the mark: the panel mounts
  await real.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.open-app:not([hidden])'), null, {timeout: 25000});
  await real.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.jp.working'), null, {timeout: 25000});   // the first fill is over
  await real.page.waitForTimeout(1000);
  const panel = () => real.page.evaluate(() => { const root = document.getElementById('jobpilotto-review-host').shadowRoot, link = root.querySelector('.open-app').getBoundingClientRect(), card = root.querySelector('.actions').getBoundingClientRect();
    return {row: !!root.querySelector('.tailor, .t-btn, .t-text'), offCentre: Math.round(Math.abs((link.x + link.width / 2) - (card.x + card.width / 2)))}; });
  const press = async selector => {   // a real click on the panel's own control
    const box = await real.page.evaluate(sel => { const b = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector(sel).getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; }, selector);
    await real.page.mouse.click(box.x, box.y);
  };
  const noteSays = pattern => real.page.waitForFunction(source => new RegExp(source).test(document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.note:not(.trace-note)')?.textContent || ''), pattern.source, {timeout: 10000});
  return {real, app, panel, press, noteSays};
}

test('the panel has no CV row, and "Open in Jobadabra" sits in the middle of its row', async () => {
  const t = await start();
  try {
    const now = await t.panel();
    assert.equal(now.row, false, 'no "General CV attached" / "Tailor in Jobadabra" row is drawn');
    assert.ok(now.offCentre <= 2, `Open in Jobadabra is ${now.offCentre}px off the centre of its row`);
    await t.press('.open-app');
    for (let i = 0; i < 20 && !t.app.opened.length; i++) await t.real.page.waitForTimeout(250);
    assert.deepEqual(t.app.opened, [{session: 's1'}], 'the app is asked to open this session');
    assert.deepEqual(t.app.events.filter(type => /tailor|add-job/.test(type)), [], 'the panel never asks the app to tailor or add the job itself');
  } finally { await t.real.close(); }
});

test('Open in Jobadabra: an app that does not answer is said on the panel, not a dead link', async () => {
  const t = await start({silent: true});
  try {
    await t.press('.open-app');
    await t.noteSays(/not answering/);
  } finally { await t.real.close(); }
});

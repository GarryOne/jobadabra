/* global document */
// The form panel's CV line says which CV goes in, and its "Tailor in Jobadabra" opens the app at this job's Tailor button: the panel never tailors itself (owner, 27 Oct 2026:
// "Send me to the app"; the app restarts the form when the tailored CV is ready, desktop/lib/tailored-restart.js). Open in Jobadabra's failure is said on the panel too.
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
  await real.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.tailor:not([hidden])'), null, {timeout: 25000});
  await real.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.jp.working'), null, {timeout: 25000});   // the first fill is over
  await real.page.waitForTimeout(1000);
  const panel = () => real.page.evaluate(() => { const root = document.getElementById('jobpilotto-review-host').shadowRoot, button = root.querySelector('.t-btn');
    return {text: root.querySelector('.tailor .t-text').textContent, button: button.hidden ? '' : button.textContent}; });
  const press = async selector => {   // a real click on the panel's own control
    const box = await real.page.evaluate(sel => { const b = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector(sel).getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; }, selector);
    await real.page.mouse.click(box.x, box.y);
  };
  const noteSays = pattern => real.page.waitForFunction(source => new RegExp(source).test(document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.note:not(.trace-note)')?.textContent || ''), pattern.source, {timeout: 10000});
  return {real, app, panel, press, noteSays};
}

test('Tailor in Jobadabra: the panel says the general CV is attached and its press opens the app at this job\'s Tailor, never tailoring itself', async () => {
  const t = await start();
  try {
    assert.deepEqual(await t.panel(), {text: 'General CV attached', button: 'Tailor in Jobadabra'});
    await t.press('.t-btn');
    for (let i = 0; i < 20 && !t.app.opened.length; i++) await t.real.page.waitForTimeout(250);
    assert.deepEqual(t.app.opened, [{session: 's1', show: 'tailor'}], 'the app is asked to open this session at its Tailor button');
    assert.deepEqual(t.app.events.filter(type => /tailor|add-job/.test(type)), [], 'the panel never asks the app to tailor or add the job itself');
  } finally { await t.real.close(); }
});

test('the CV line follows the app: "Tailoring in Jobadabra…" while the window tailors, "Tailored CV attached" once it is written, no button in either', async () => {
  const t = await start({cv: {tailored: false, working: true}});
  try {
    assert.deepEqual(await t.panel(), {text: 'Tailoring in Jobadabra…', button: ''});
    t.app.cv = {tailored: true, working: false};
    await t.real.page.waitForFunction(() => /Tailored CV attached/.test(document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.tailor .t-text').textContent), null, {timeout: 15000});
    assert.deepEqual(await t.panel(), {text: 'Tailored CV attached', button: ''});
  } finally { await t.real.close(); }
});

test('Tailor in Jobadabra and Open in Jobadabra: an app that does not answer is said on the panel, not a dead link', async () => {
  const t = await start({silent: true});
  try {
    await t.press('.t-btn');
    await t.noteSays(/not answering/);
    await t.real.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.open-app').hidden, null, {timeout: 15000});
    await t.press('.open-app');
    await t.noteSays(/not answering/);
  } finally { await t.real.close(); }
});

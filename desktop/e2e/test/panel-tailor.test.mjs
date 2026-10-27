/* global document */
// The form panel's "Tailor CV + letter" answers ON THE PANEL in every branch (started, done, not in your list, failed, app silent), and the other controls that ask the app
// (Open in Jobadabra, Add this job) show their progress and failure there too. Real extension on a fixture form, a stand-in app with fake data, no paid AI, nothing live (owner, 19 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const FORM = `<!doctype html><title>Senior Site Reliability Engineer</title><form><h1>Apply</h1>
<label>Full name <input name="n" required></label><label>Email <input name="e" type="email" required></label><label>Phone <input name="p" required></label><label>City <input name="c" required></label></form>`;
const URL = 'https://jobs.example.test/apply';

// The stand-in app: what the real app's tailor handler does, with a few seconds instead of a model call. mode: 'ok' | 'not-listed' | 'fail' | 'silent'.
async function start(mode) {
  const app = {phase: 'idle', events: []};
  const status = () => (app.phase === 'running' ? {state: 'running'} : app.phase === 'done' ? {state: 'done', letter: true} : app.phase === 'failed' ? {state: 'failed', error: 'Choose your AI in Settings first.'}
    : app.phase === 'not-listed' ? {state: 'not-listed'} : app.phase === 'adding' ? {state: 'adding'} : app.phase === 'added' ? {state: 'added'} : null);
  const answer = {
    '/extension/kit': () => ({job: {code: 'J1', title: 'Senior SRE', company: 'Example'}, kit: {answers: []}}),
    '/extension/review': () => ({matched: 's1', session: {id: 's1', url: URL, status: 'running', stuck: false}, watch: [], commands: [], theme: 'light',
      cv: {tailored: app.phase === 'done', working: app.phase === 'running', status: status()}}),
    '/extension/open': () => ({ok: mode !== 'silent'}),
    '/extension/event': body => {
      const event = JSON.parse(body || '{}');
      app.events.push(event.type);
      if (mode === 'silent' && ['tailor-cv', 'add-job'].includes(event.type)) return null;
      if (event.type === 'tailor-cv') {
        if (mode === 'not-listed') app.phase = 'not-listed';
        else if (mode === 'fail') app.phase = 'failed';
        else { app.phase = 'running'; setTimeout(() => { app.phase = 'done'; }, 3500); }
      }
      if (event.type === 'add-job') { app.phase = 'added'; }
      return {ok: true};
    }};
  const real = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true, answer});
  await real.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: FORM}));
  await real.page.goto(`${URL}#jobpilotto-fill`);   // the app opens the tab with the mark: the panel mounts
  await real.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.tailor:not([hidden])'), null, {timeout: 25000});
  await real.page.waitForTimeout(4000);   // the first fill (the page's mark) ends and the layout settles
  const text = () => real.page.evaluate(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.tailor .t-text').textContent);
  const waitText = (pattern, timeout = 15000) => real.page.waitForFunction(source => new RegExp(source).test(document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.tailor .t-text')?.textContent || ''), pattern.source, {timeout})
    .catch(async error => { throw new Error(`${error.message} — panel says "${await text()}", note "${await noteText()}", app saw ${JSON.stringify(app.events)}`); });
  const press = async selector => {   // a real click on the panel's own control
    const box = await real.page.evaluate(sel => { const b = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector(sel).getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; }, selector);
    await real.page.mouse.click(box.x, box.y);
  };
  const noteText = () => real.page.evaluate(() => { const n = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.note:not(.trace-note)'); return n.hidden ? '' : n.textContent; });
  return {real, app, text, waitText, press, noteText};
}

test('Tailor CV + letter: the press is answered on the panel, then "Tailored: CV + letter ready"', async () => {
  const t = await start('ok');
  try {
    assert.match(await t.text(), /General CV attached/, 'positive control: the panel offers Tailor before the press');
    assert.equal(await t.real.page.evaluate(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.t-btn').textContent), 'Tailor CV + letter');
    await t.press('.t-btn');
    await t.waitText(/Tailoring your CV \+ cover letter.*1–2 minutes/);   // started, with the time it takes
    assert.deepEqual(t.app.events.filter(type => type === 'tailor-cv'), ['tailor-cv']);
    await t.waitText(/Tailored: CV \+ letter ready/);   // done: what was attached
    assert.match(await t.text(), /Press Fill again to attach/);
  } finally { await t.real.close(); }
});

test('Tailor CV: a job not in the list says so on the panel and offers one button to add it', async () => {
  const t = await start('not-listed');
  try {
    await t.press('.t-btn');
    await t.waitText(/not in your list/);
    assert.equal(await t.real.page.evaluate(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.t-btn').textContent), 'Add this job');
    await t.press('.t-btn');
    await t.waitText(/Added to your list/);
    assert.ok(t.app.events.includes('add-job'));
  } finally { await t.real.close(); }
});

test('Tailor CV: a failure says why on the panel', async () => {
  const t = await start('fail');
  try {
    await t.press('.t-btn');
    await t.waitText(/Not done: Choose your AI in Settings first/);
  } finally { await t.real.close(); }
});

test('Tailor CV: an app that does not answer is said on the panel, not a dead link', async () => {
  const t = await start('silent');
  try {
    await t.press('.t-btn');
    await t.real.page.waitForFunction(() => /not answering/.test(document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.note:not(.trace-note)')?.textContent || ''), null, {timeout: 10000});
  } finally { await t.real.close(); }
});

test('Open in Jobadabra: an app that refuses is said on the panel', async () => {
  const t = await start('silent');
  try {
    await t.real.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.open-app').hidden, null, {timeout: 15000});
    await t.press('.open-app');
    await t.real.page.waitForFunction(() => /not answering/.test(document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.note:not(.trace-note)')?.textContent || ''), null, {timeout: 10000});
  } finally { await t.real.close(); }
});

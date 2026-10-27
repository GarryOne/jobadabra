// The app's own extension server offline for a row replay (lib/offline-app.mjs): starts in seconds on its own port in a temp folder, answers the extension as a
// person's app does (the fake applicant and the fixture CV, never the person's), refuses every host but this computer, and stops with nothing left running.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {DUMMY_KEY} from '../lib/engine.mjs';
import {startOfflineApp} from '../lib/offline-app.mjs';
import {withDerived} from '../../lib/target-roles.js';

const REAL = path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto');

test('the offline app answers the extension with the fake applicant, on its own port and folder, and stops cleanly', async () => {
  const started = Date.now();
  const app = await startOfflineApp();
  try {
    assert.ok(Date.now() - started < 15000, `started in ${Date.now() - started} ms`);
    assert.notEqual(app.port, 47111);
    assert.ok(!(path.resolve(app.dir) + path.sep).startsWith(REAL + path.sep), 'never the app\'s real folder');
    const me = await (await fetch(`${app.url}/extension/me`, {headers: {authorization: `Bearer ${app.token}`}})).json();
    assert.equal(me.contact?.email, 'test.candidate@example.com', JSON.stringify(me).slice(0, 300));
    assert.equal(me.contact?.first_name ?? me.contact?.firstName ?? me.contact?.['first name'], 'Test');
    assert.ok(me.resume?.data?.length > 1000, 'the fixture CV');
    assert.equal(fs.readFileSync(path.join(app.dir, 'cv.pdf')).equals(fs.readFileSync(new URL('../fixtures/cv.pdf', import.meta.url))), true);
    const refused = await fetch(`${app.url}/extension/me`, {headers: {authorization: 'Bearer wrong'}});
    assert.equal(refused.status, 401);
  } finally { await app.close(); }
  await assert.rejects(fetch(`${app.url}/extension/me`), 'nothing is left listening');
});

// The Electron run's applicant (lib/seed.mjs fastSeed: saveStrategy with demo/draft.json), not a contact alone: with only a contact the fill's AI read a 250-character
// profile and judged a Zurich applicant ineligible for a Sydney role, so the no-Electron run stopped where the Electron one filled (Teamtailor, 11 Oct 2026).
test('the offline app holds the same applicant as the Electron run: the strategy\'s Profile, standard answers and search settings, with the stand-in contact', async () => {
  const draft = JSON.parse(fs.readFileSync(new URL('../../demo/draft.json', import.meta.url), 'utf8')).draft;
  const app = await startOfflineApp();
  try {
    const profile = fs.readFileSync(path.join(app.dir, 'profile.md'), 'utf8');
    assert.ok(profile.includes(draft.profile_markdown.trim()), `the strategy's Profile is kept (${profile.length} characters)`);
    assert.match(profile, /test\.candidate@example\.com/, 'the stand-in contact, never the draft\'s or a person\'s');
    assert.equal(fs.readFileSync(path.join(app.dir, 'answers.md'), 'utf8').trim(), draft.answers_markdown.trim());
    // Why (8c8bd70, 21 Oct 2026): the draft holds one list, target_roles; role_keywords is written from it, so the expected list is the app's own derivation.
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app.dir, 'config', 'search.json'), 'utf8')).role_keywords, withDerived(draft.search).role_keywords);
  } finally { await app.close(); }
});

test('inside the offline app, a call to any host but this computer is refused and named (checked before it serves)', async () => {
  const app = await startOfflineApp();
  try { assert.equal(app.guarded, true); } finally { await app.close(); }
});

test('the offline app never asks the model by default: a page-kind ask outside the kept answers is refused, not answered by claude -p', async () => {
  const app = await startOfflineApp();
  try {
    const body = {url: 'https://jobs.example.org/x', title: 'x', headings: ['x'], controls: [], buttons: ['Apply'], frames: []};
    const answer = await (await fetch(`${app.url}/extension/page-kind`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${app.token}`,
      origin: `chrome-extension://${app.extensionId}`}, body: JSON.stringify(body)})).json();
    assert.ok(!answer.kind || answer.by !== 'ai', `no AI answer: ${JSON.stringify(answer).slice(0, 200)}`);
    assert.match(app.logText() + JSON.stringify(answer), /not in the row's kept answers/);
  } finally { await app.close(); }
});

test('the harness drives the app as its window would: settings, the contact, Apply (the address handed to the harness browser) and the sessions', async () => {
  const app = await startOfflineApp();
  try {
    const opened = [];
    app.onOpen(url => opened.push(url));
    assert.equal((await app.call('saveSettings', {escalation: 'on'})).escalation, 'on');
    assert.equal((await app.call('settings')).escalation, 'on');
    assert.equal((await app.call('saveContact', {first_name: 'Test', last_name: 'Candidate', email: 'test.candidate@example.com'})).ok, true);
    const applied = await app.call('applyOne', 'https://jobs.example.org/job/42', {title: 'Engineer', company: 'Example'});
    assert.equal(applied.ok, true, JSON.stringify(applied));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(opened.some(url => url.startsWith('https://jobs.example.org/job/42') && url.includes('#jobpilotto-fill')), `opened: ${JSON.stringify(opened)}`);
    assert.ok((await app.call('sessions')).some(session => session.url === 'https://jobs.example.org/job/42'));
    await assert.rejects(app.call('noSuchCommand'), /unknown command/);
  } finally { await app.close(); }
});

// The pool on a CI runner (.github/workflows/record-sites.yml): no Claude Code there, so the app asks through its own API engine, to the harness's metering proxy on
// this computer (lib/live-row.mjs), never straight to the internet. Here the proxy answers itself (canned) and the key is the placeholder: nothing is paid.
test('with an AI proxy the offline app asks through its API engine and the proxy on this computer, never claude -p', async () => {
  const proxy = await startAiProxy();
  proxy.setCanned(() => JSON.stringify({kind: 'posting', confidence: 0.9, apply_button: 'Apply', apply_button_kind: 'apply', apply_route: '', apply_by: 'form', apply_email: '',
    form_frame: -1, account_step: '', register_control: '', signin_control: '', account_button: '', bot_check: false}));
  const app = await startOfflineApp({ask: true, api: {url: proxy.url, key: DUMMY_KEY}});
  try {
    assert.equal(JSON.parse(fs.readFileSync(path.join(app.dir, 'settings.json'), 'utf8')).aiEngine, 'api');
    const body = {url: 'https://jobs.example.org/x', title: 'x', headings: ['x'], controls: [], buttons: ['Apply'], frames: []};
    const answer = await (await fetch(`${app.url}/extension/page-kind`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${app.token}`,
      origin: `chrome-extension://${app.extensionId}`}, body: JSON.stringify(body)})).json();
    assert.ok(proxy.stats.canned >= 1, `the page-kind ask reached the proxy: ${JSON.stringify(proxy.stats)}`);
    assert.equal(answer.kind, 'posting', JSON.stringify(answer).slice(0, 200));
  } finally { await app.close(); await proxy.close(); }
});

test('the API path takes a proxy on this computer only, and a real key only on CI', async () => {
  await assert.rejects(startOfflineApp({ask: true, api: {url: 'https://api.anthropic.com', key: DUMMY_KEY}}), /127\.0\.0\.1/);
  await assert.rejects(startOfflineApp({ask: true, api: {url: 'http://127.0.0.1:9', key: 'sk-ant-api03-real-looking'}, env: {}}), /CI only/);
});

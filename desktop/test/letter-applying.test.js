// The Applying card shows important missing-letter setup even with every required field complete, using the same server-derived state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {document, window} = globalThis;
for (const name of ['setTimeout', 'setInterval']) { const real = globalThis[name]; globalThis[name] = (...args) => { const timer = real(...args); timer?.unref?.(); return timer; }; }
const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
for (const id of new Set([...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]))) document.body.append(Object.assign(document.createElement('div'), {id}));
const status = {state: 'draft', ready: false, reason: 'Your cover letter is a draft and needs review.', action: 'Review cover letter'};
window.pilot = new Proxy({cvOf: async (_url, given) => ({tailored: false, coverLetterStatus: given ? {state: 'ready', ready: true, source: 'form'} : status})}, {get: (obj, key) => obj[key] || (() => null)});
const {shared} = await import('../renderer/pages/shared.js');
shared.state = {settings: {}};
shared.allJobs = [];
shared.formsOpen = new Set();
const {showFormCard} = await import('../renderer/pages/session-form-card.js');

test('Applying shows HIGH PRIORITY, the approval action and no ready badge for a missing approved letter', async () => {
  showFormCard({id: 'fictional', url: 'https://example.test/job', kind: 'form', status: 'done', inChrome: true}, {total: 3, left: 0, ready: true, letterAsked: true});
  await new Promise(resolve => setImmediate(resolve));
  const row = document.getElementById('ss-before-letter');
  assert.ok(row, 'missing-letter row exists');
  assert.equal(row.hidden, false);
  assert.match(document.getElementById('ss-before-letter-title').textContent, /HIGH PRIORITY/);
  assert.equal(document.getElementById('ss-before-letter-btn').textContent, status.action);
  assert.doesNotMatch(document.getElementById('ss-form-pill').textContent, /Ready to submit/);
});


test('an observed written letter on this form clears setup without changing the base fallback preference', async () => {
  showFormCard({id: 'fictional', url: 'https://example.test/job', kind: 'form', status: 'done', inChrome: true}, {total: 3, left: 0, ready: true, letterGiven: true});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById('ss-before-letter').hidden, true);
  assert.match(document.getElementById('ss-form-pill').textContent, /Ready to submit/);
});

test('tailoring redraw retains the observed written letter', async () => {
  const calls = [];
  window.pilot.cvOf = async (_url, given) => {calls.push(given); return {tailored: false, coverLetterStatus: given ? {state: 'ready', ready: true} : status};};
  window.pilot.tailorCv = async () => ({ok: true});
  const url = 'https://example.test/tailor-letter';
  shared.allJobs = [{url, code: 'fictional', title: 'Example role', company: 'Example'}];
  showFormCard({id: 'fictional', url, kind: 'form', status: 'done', inChrome: true}, {total: 3, left: 0, ready: true, letterGiven: true, letterAsked: true});
  await new Promise(resolve => setImmediate(resolve));
  await document.getElementById('ss-before-cv-btn').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [true, true]);
  assert.equal(document.getElementById('ss-before-letter').hidden, true);
});

test('a form that asks for no letter remains ready while general letter setup is pending', async () => {
  showFormCard({id: 'fictional', url: 'https://example.test/no-letter', kind: 'form', status: 'done', inChrome: true}, {total: 3, left: 0, ready: true, letterAsked: false});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById('ss-before-letter').hidden, true);
  assert.match(document.getElementById('ss-form-pill').textContent, /Ready to submit/);
});

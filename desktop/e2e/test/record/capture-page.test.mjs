// Capturing a page (lib/capture-page.mjs): nothing personal survives the scrub; the person's own values are found in the app's files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {scrub as scrubLive} from '../../../lib/live-capture.js';
import {FAKE, personalValues, scrub, writeCapture} from '../../lib/capture-page.mjs';

test('emails but example.*, phone numbers and the person\'s own name and email are replaced', () => {
  const values = personalValues(['# Profile\nName: Ana Maria Popescu\nEmail: ana.popescu@gmail.com\nPhone: +41 79 555 12 34']);
  const html = '<p>Welcome back, Ana Popescu (ana.popescu@gmail.com, +41 79 555 12 34). Write to jobs@example.com.</p>';
  const out = scrub(html, values);
  assert.ok(!/ana|popescu|gmail|555/i.test(out), out);
  assert.match(out, /jobs@example\.com/);
  assert.ok(out.includes(FAKE.email) && out.includes(FAKE.name) && out.includes(FAKE.phone));
});

test('a capture is written into its case folder and listed in case.json without its query', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-'));
  writeCapture({out, caseName: 'email-first-signup-1', pageName: 'login', url: 'https://auth.example.org/u/login/identifier?state=SECRET#x', html: '<p>x</p>'});
  writeCapture({out, caseName: 'email-first-signup-1', pageName: 'login', url: 'https://auth.example.org/u/login/identifier', html: '<p>y</p>'});
  const item = JSON.parse(fs.readFileSync(path.join(out, 'email-first-signup-1', 'case.json'), 'utf8'));
  assert.deepEqual(item.pages, [{url: 'https://auth.example.org/u/login/identifier', file: 'login.html'}]);
  assert.equal(fs.readFileSync(path.join(out, 'email-first-signup-1', 'login.html'), 'utf8'), '<p>y</p>');
});

test('the page capture and the live sketch scrub an email and a phone the same way: a replay of the page sends the sketch the live run sent', () => {
  for (const email of ['jobs@hornbach.example.com', 'ana.popescu@gmail.com', 'hr@firma.ch', 'jobs@example.com', 'talent@example.org', '+41 79 555 12 34', '079 555 12 34', 'Ref 2026-10-11']) {
    assert.equal(scrub(`Mail ${email} now`), scrubLive(`Mail ${email} now`), email);
  }
});

test('a name word is scrubbed, an acronym that spells it is not (the fake applicant "Ada" and "the Americans with Disabilities Act (ADA)")', () => {
  const values = personalValues(['Name: Ada Tester']);
  const out = scrub('<p>Hello Ada, ada tester here. The Americans with Disabilities Act (ADA) applies.</p>', values);
  assert.match(out, /\(ADA\)/);
  assert.doesNotMatch(out, /Hello Ada|ada tester/i);
});

test('a long number that is part of an identifier (Greenhouse question_4553828006) is no phone: ids and labels stay linked; a real phone is still scrubbed', () => {
  const html = '<label for="question_4553828006">Legal Address</label><input id="question_4553828006"><p>Call +41 79 555 12 34 or 0795551234.</p>';
  const out = scrub(html);
  assert.match(out, /for="question_4553828006"/);
  assert.match(out, /id="question_4553828006"/);
  assert.doesNotMatch(out, /555 12 34|0795551234/);
});

test('a page capture keeps a web address whole: a long digit run in a stylesheet or image name is not a phone number; real phones, emails and the person\'s own values are still scrubbed', async () => {
  const {scrubPage} = await import('../../lib/capture-page.mjs');
  const html = '<link rel="stylesheet" href="https://cdn.example.net/tenantcss/main-12345678901.css"><style>.a{background:url(https://cdn.example.net/img-98765432101.png)}</style>'
    + '<p>Call +41 79 123 45 67 or mail anna@gmail.com</p><a href="tel:+41 79 123 45 67">call</a><a href="mailto:anna@gmail.com">mail</a><a href="https://www.linkedin.com/in/anna-muster">profile</a>';
  const out = scrubPage(html, new Map([['muster', 'name']]));
  assert.ok(out.includes('href="https://cdn.example.net/tenantcss/main-12345678901.css"'), 'the stylesheet address survives');
  assert.ok(out.includes('url(https://cdn.example.net/img-98765432101.png)'), 'a url() in CSS survives');
  assert.ok(!out.includes('+41') && !out.includes('123 45 67'), 'a phone in text or a tel: link is scrubbed');
  assert.ok(!out.includes('gmail'), 'an email in text or a mailto: link is scrubbed');
  assert.ok(!/muster/i.test(out), 'the person\'s own value is scrubbed inside an address too');
  assert.ok(out.includes('href="https://www.linkedin.com/in/anna-'), 'the rest of that address stays');
  assert.equal(scrub(html, new Map()).includes('main-(phone).css'), true, 'scrub (the old function, used for text and memos) still replaces it: only the page path changed');
});

test('the memo key of a known request is unchanged by the page-capture scrub (fakeContacts and the key normalisation stay as they were)', async () => {
  const {memoKey} = await import('../../../lib/ai/model-memo.js');
  assert.equal(memoKey({model: 'claude-haiku-5-5', system: 'Say what kind of page this is.', messages: [{role: 'user', content: 'sheet https://cdn.example.net/main-12345678901.css call +41 79 123 45 67 mail anna@gmail.com'}]}),
    '9508d32d7d284e2c08c3781065516e06b6ade603d711c712eaf8513ba509a5d6');
});

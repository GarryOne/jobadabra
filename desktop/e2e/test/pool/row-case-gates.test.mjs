// lib/row-case-gates.mjs: the privacy and size gates a row's case folder passes BEFORE it is written (npm run row-to-case); the privacy test of the recorded folder uses the same function.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CASE_FAIL, CASE_WARN, FOLDER_FAIL, folderVerdict, privacyFindings, sizeVerdict} from '../../lib/row-case-gates.mjs';

test('privacy: an email but example.*, a phone, a typed value, a URL query are each found, by kind and file, never by value', () => {
  const found = privacyFindings({'a/page.html': '<p>mail anna@gmail.com or test@example.com</p>', 'a/b.html': '<input type="text" value="Anna">', 'a/c.html': 'call +41 79 123 45 67 or 044 123 45 67',
    'a/d.html': '<a href="https://x.example/p?token=1">x</a>', 'a/ok.html': '<input type="submit" value="Send"><p>test@example.org</p>'});
  assert.deepEqual(found, ['a/page.html: an email', 'a/b.html: a typed value', 'a/c.html: a phone number', 'a/d.html: a URL query string']);
  assert.ok(!JSON.stringify(found).includes('anna'));
});

test('privacy: the person\'s own values (from the app profile) are found too, as a kind', () => {
  assert.deepEqual(privacyFindings({'a/p.html': '<p>Maria Muster lives here</p>'}, new Map([['muster', 'name']])), ['a/p.html: name']);
  assert.deepEqual(privacyFindings({'a/p.html': '<p>call 0041791234567</p>'}, new Map([['41791234567', 'phone']])), ['a/p.html: phone']);
});

test('size: a case warns at 200 KB and fails at 300 KB; the folder fails at 8 MB', () => {
  assert.deepEqual([CASE_WARN, CASE_FAIL, FOLDER_FAIL], [200 * 1024, 300 * 1024, 8 * 1024 * 1024]);
  assert.deepEqual([sizeVerdict(100 * 1024), sizeVerdict(CASE_WARN + 1), sizeVerdict(CASE_FAIL + 1)], ['ok', 'warn', 'fail']);
  assert.equal(folderVerdict(FOLDER_FAIL - 1), 'ok');
  assert.equal(folderVerdict(FOLDER_FAIL + 1), 'fail');
});

test('privacy: a long unbroken run (a base64 blob) is scanned at once, not quadratically', () => {
  const started = Date.now(), text = `mail a@example.com ${'x'.repeat(400 * 1024)}`;
  assert.deepEqual(privacyFindings({'a/p.html': text}), []);
  assert.deepEqual(privacyFindings({'a/q.html': `${text} b@gmail.com`}), ['a/q.html: an email']);
  assert.ok(Date.now() - started < 2000);
});

test('privacy: a script\'s data-…-value attribute and a radio\'s option name are no typed value; a later input\'s value still is', () => {
  const clean = '<input type="radio" data-q-question-value="2805226" value="yes" name="q"><input type="tel" data-country-value="AU"><input type="submit" value="Send">';
  assert.deepEqual(privacyFindings({'a/clean.html': clean}), []);
  assert.deepEqual(privacyFindings({'a/typed.html': `${clean}<input type="text" value="Anna">`}), ['a/typed.html: a typed value']);
});

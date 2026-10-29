// A "Chrome isn't reporting" card with a job URL offers the reopen first, and Open Chrome (the connect step) always stays (renderer/pages/session-next-step.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {silentChromeButtons} from '../renderer/pages/silent-chrome.js';

test('a session with a job URL offers Open it again first, then Open Chrome', () => {
  assert.deepEqual(silentChromeButtons({url: 'https://jobs.example.test/engineer'}), ['reopen', 'connect']);
});

test('a session with no job URL offers only Open Chrome', () => {
  assert.deepEqual(silentChromeButtons({url: ''}), ['connect']);
  assert.deepEqual(silentChromeButtons(null), ['connect']);
});

test('the silent card\'s reopen calls the form reopen, never the extension settings page (the reported bug)', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../renderer/pages/session-next-step.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function renderSilent(item) {'), source.indexOf('// The first look is over', source.indexOf('function renderSilent(item) {')));
  assert.match(body, /const reopen = reopenButton\(item\);/, 'the silent card draws the reopen first');
  assert.doesNotMatch(body.split('const connect')[0], /extensionOptions/, 'the reopen never runs the settings page');
  assert.match(source, /function reopenButton\(item\) \{\s*return sessionButton\('Open it again', 'primary', event => reopenClosedTab\(item, event\.currentTarget\)/, 'the reopen calls reopenClosedTab');
});

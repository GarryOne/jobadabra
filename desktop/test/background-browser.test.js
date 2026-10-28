// Owned hidden-browser startup contracts: no profile cloning, visible startup page, global process kill, or silent download.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {browserArguments, verifiedDebugPort} from '../lib/background-browser.js';

test('background browser launch uses only its owned profile and starts without a visible page', () => {
  const args = browserArguments('/owned/profile', '/owned/extension');
  assert.ok(args.includes('--no-startup-window'));
  assert.ok(args.includes('--user-data-dir=/owned/profile'));
  assert.ok(args.includes('--load-extension=/owned/extension'));
  assert.ok(args.includes('--remote-debugging-port=0'));
  // Why (2026-10-28, owner): the person sees a held page in the app's live view, never a revealed window; headless keeps it off the screen, the Dock and focus.
  assert.ok(args.includes('--headless=new'));
  assert.equal(args.some(arg => /^https?:/.test(arg)), false);
});

test('a cached CDP port is accepted only after the browser proves the exact owned profile', () => {
  assert.equal(verifiedDebugPort('12345\n/devtools/browser/a', ['--user-data-dir=/owned/profile'], '/owned/profile'), 12345);
  assert.equal(verifiedDebugPort('12345\n/devtools/browser/a', ['--user-data-dir=/someone/else'], '/owned/profile'), null);
  assert.equal(verifiedDebugPort('0\n/path', ['--user-data-dir=/owned/profile'], '/owned/profile'), null);
});

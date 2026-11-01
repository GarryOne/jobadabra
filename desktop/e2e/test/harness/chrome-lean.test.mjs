// lib/chrome-lean.mjs: opt-in lighter Chrome flags; headless only; launchBrowser passes them on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {LEAN_FLAGS, leanChrome} from '../../lib/chrome-lean.mjs';

test('off by default, on with E2E_CHROME_LEAN=1, never in a window someone watches', () => {
  assert.deepEqual(leanChrome({}), []);
  assert.deepEqual(leanChrome({E2E_CHROME_LEAN: '1'}), LEAN_FLAGS);
  assert.deepEqual(leanChrome({E2E_CHROME_LEAN: '1', E2E_HEADED: '1'}), []);
});

test('the flags never block what a page loads or runs', () => {
  for (const flag of LEAN_FLAGS) assert.doesNotMatch(flag, /image|javascript|site-per-process|isolation|blink-settings|disable-web-security/i, flag);
});

test('launchBrowser passes them to the browser', () => {
  assert.match(fs.readFileSync(new URL('../../lib/extension.mjs', import.meta.url), 'utf8'), /\.\.\.leanChrome\(\)/);
});

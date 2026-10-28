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

test('the e2e harness may point the hidden browser at the test forms, nobody else: only under the e2e flag, only a host map and the test certificate', () => {
  const extra = JSON.stringify(['--host-resolver-rules=MAP boards.greenhouse.io 127.0.0.1:5', '--ignore-certificate-errors', '--no-sandbox', '--proxy-server=http://evil.example', '--remote-debugging-address=0.0.0.0']);
  const asked = {JOB_PILOTTO_E2E_BACKGROUND_BROWSER_ARGS: extra};
  assert.deepEqual(browserArguments('/p', '/e', asked), browserArguments('/p', '/e', {}), 'a person\'s environment never changes the launch, even with the variable set');
  const args = browserArguments('/p', '/e', {...asked, JOB_PILOTTO_E2E: '1'});
  assert.ok(args.includes('--host-resolver-rules=MAP boards.greenhouse.io 127.0.0.1:5'));
  assert.ok(args.includes('--ignore-certificate-errors'));
  assert.ok(args.includes('--no-sandbox'), 'under e2e only: a CI runner may not allow the sandbox');
  assert.equal(browserArguments('/p', '/e', {}).includes('--no-sandbox'), false, 'a person\'s browser keeps its sandbox');
  assert.equal(args.some(arg => /proxy-server|remote-debugging-address/.test(arg)), false, 'nothing else is let through');
  assert.deepEqual(browserArguments('/p', '/e', {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_BACKGROUND_BROWSER_ARGS: 'not json'}), browserArguments('/p', '/e', {}));
});

test('a cached CDP port is accepted only after the browser proves the exact owned profile', () => {
  assert.equal(verifiedDebugPort('12345\n/devtools/browser/a', ['--user-data-dir=/owned/profile'], '/owned/profile'), 12345);
  assert.equal(verifiedDebugPort('12345\n/devtools/browser/a', ['--user-data-dir=/someone/else'], '/owned/profile'), null);
  assert.equal(verifiedDebugPort('0\n/path', ['--user-data-dir=/owned/profile'], '/owned/profile'), null);
});

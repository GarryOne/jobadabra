// An e2e run keeps the app's windows hidden and out of focus; a user never gets that.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {captureQuery, hiddenRun, hideWindows} from '../lib/e2e-hidden.js';
import {browserCommand} from '../lib/browser-launch.js';

const fakes = () => {
  class BrowserWindow { show() { return 'shown'; } focus() { return 'focused'; } moveTop() { return 'top'; } }
  const app = {policy: 'regular', focus: () => 'stolen', setActivationPolicy(policy) { this.policy = policy; }};
  return {app, BrowserWindow};
};

test('hidden only in an e2e run that asks for it', () => {
  assert.equal(hiddenRun({}), false);
  assert.equal(hiddenRun({JOB_PILOTTO_E2E_HIDDEN: '1'}), false, 'a user never gets it');
  assert.equal(hiddenRun({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '0'}), false);
  assert.equal(hiddenRun({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '1'}), true);
});

test('a screenshot run is hidden too: no Dock icon, no show, no focus', () => {
  assert.equal(hiddenRun({JOB_PILOTTO_SMOKE: '/tmp/a.png'}), true);
  const {app, BrowserWindow} = fakes();
  assert.equal(hideWindows({app, BrowserWindow, env: {JOB_PILOTTO_SMOKE: '/tmp/a.png'}, platform: 'darwin'}), true);
  assert.equal(new BrowserWindow().show(), undefined);
  assert.equal(new BrowserWindow().focus(), undefined);
  assert.equal(app.focus(), undefined);
  assert.equal(app.policy, 'accessory');
});

test('every script that starts electron for a picture sets JOB_PILOTTO_SMOKE (so it is hidden)', async () => {
  const {readFileSync} = await import('node:fs');
  for (const name of ['shot', 'ui-shots', 'screenshots']) {
    assert.match(readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), 'utf8'), /JOB_PILOTTO_SMOKE:|JOB_PILOTTO_SMOKE:? /, name);
  }
});

test('a hidden run never shows or focuses anything', async () => {
  const {app, BrowserWindow} = fakes();
  assert.equal(hideWindows({app, BrowserWindow, env: {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '1'}, platform: 'darwin'}), true);
  const window = new BrowserWindow();
  assert.equal(window.show(), undefined);
  assert.equal(window.focus(), undefined);
  assert.equal(app.focus(), undefined);
  assert.equal(app.policy, 'accessory');
});

test('otherwise the app is left alone', () => {
  const {app, BrowserWindow} = fakes();
  assert.equal(hideWindows({app, BrowserWindow, env: {JOB_PILOTTO_E2E: '1'}, platform: 'darwin'}), false);
  assert.equal(new BrowserWindow().show(), 'shown');
  assert.equal(app.policy, 'regular');
});

test('a hidden run opens browser tabs in the background', () => {
  const exists = () => true;
  assert.deepEqual(browserCommand(['https://x'], 'darwin', {HOME: '/h'}, exists)[1], ['-a', 'Google Chrome', 'https://x']);
  assert.deepEqual(browserCommand(['https://x'], 'darwin', {HOME: '/h', JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '1'}, exists)[1], ['-g', '-a', 'Google Chrome', 'https://x']);
});

test('a screenshot run opens the window marked as a capture; a normal or e2e run does not', () => {
  // Owner, 17 Oct 2026: the first-launch tour covered the sidebar in PR shots. Every capture tool (shot, ui-shots, screenshots, drawer-shots,
  // find-card-shots, smoke-screens) sets JOB_PILOTTO_SMOKE, so the mark is given here once and the renderer leaves its one-time overlays out.
  assert.deepEqual(captureQuery({JOB_PILOTTO_SMOKE: '/x/shot.png'}), {capture: '1'});
  assert.equal(captureQuery({}), undefined);
  assert.equal(captureQuery({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_HIDDEN: '1'}), undefined);
  const windowCode = fs.readFileSync(new URL('../lib/main-window.js', import.meta.url), 'utf8');
  assert.match(windowCode, /loadFile\([^\n]*captureQuery\(\)/, 'the main window passes the capture mark when it loads its page');
});

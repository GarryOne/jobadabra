// Pages rendered for the engine in the app's own Chromium (lib/page-render.js, src/sources/render.py): public addresses only, the engine's own
// user agent, and the local route only for the engine with this run's key (6 Oct 2026: job sites that only exist after their scripts run).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as pageRender from '../lib/page-render.js';

test('only public web addresses are rendered, never this computer or the local network', () => {
  for (const ok of ['https://jobs.migros.ch/de', 'http://example.com/jobs', 'https://93.184.216.34/']) assert.equal(pageRender.publicUrl(ok), true, ok);
  for (const no of ['http://localhost:47111/', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.20.0.1/', 'http://169.254.169.254/latest',
    'http://[::1]/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://printer.local/', 'http://intranet/', 'not a url']) assert.equal(pageRender.publicUrl(no), false, no);
});

test('the user agent is the engine\'s, never a browser\'s', () => {
  const ours = 'Jobadabra/0.1 (personal job search; contact via GitHub GarryOne/jobadabra) browser';
  assert.equal(pageRender.agentOf(ours), ours);
  assert.equal(pageRender.agentOf('Mozilla/5.0 (Macintosh) Chrome/130'), 'Jobadabra browser');
});

test('a page is loaded in a hidden window of its own session, its HTML returned, the window destroyed', async () => {
  const made = [];
  class FakeWindow {
    constructor(options) { this.options = options; this.destroyed = false; made.push(this);
      const listeners = {};
      this.webContents = {session: {webRequest: {onBeforeRequest: fn => { this.filter = fn; }}}, on: (name, fn) => { listeners[name] = fn; },
        setWindowOpenHandler: fn => { this.opens = fn; }, executeJavaScript: async () => '<html>jobs</html>'};
      this.fire = (...args) => listeners['did-navigate']?.(...args); }
    loadURL(url, {userAgent}) { this.url = url; this.agent = userAgent; this.fire({}, url, 200); return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const result = await pageRender.renderPage('https://jobs.migros.ch/de', {BrowserWindow: FakeWindow, userAgent: 'Jobadabra browser', wait: async () => {}});
  assert.deepEqual(result, {status: 200, html: '<html>jobs</html>'});
  const [win] = made;
  assert.equal(win.options.show, false);
  assert.equal(win.options.webPreferences.partition, 'jobadabra-render', 'its own session: never the user\'s cookies');
  assert.equal(win.destroyed, true);
  assert.deepEqual(win.opens(), {action: 'deny'});
  win.filter({resourceType: 'image'}, answer => assert.equal(answer.cancel, true));
  assert.deepEqual(await pageRender.renderPage('http://127.0.0.1:47111/', {BrowserWindow: FakeWindow}), {error: 'not a public web address'});
  assert.equal(made.length, 1, 'no window for a local address');
});

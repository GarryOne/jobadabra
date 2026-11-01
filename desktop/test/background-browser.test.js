// Owned hidden-browser startup contracts: no profile cloning, visible startup page, global process kill, or silent download.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserArguments, createBackgroundBrowser, verifiedDebugPort} from '../lib/background-browser.js';

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

test('the e2e harness may point the hidden browser at the test forms, nobody else: only under the e2e flag, only a host map, the test certificate and no-sandbox', () => {
  const extra = JSON.stringify(['--host-resolver-rules=MAP boards.greenhouse.io 127.0.0.1:5', '--ignore-certificate-errors', '--no-sandbox', '--proxy-server=http://evil.example', '--remote-debugging-address=0.0.0.0']);
  const asked = {JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: extra};
  assert.deepEqual(browserArguments('/p', '/e', asked), browserArguments('/p', '/e', {}), 'a person\'s environment never changes the launch, even with the variable set');
  const args = browserArguments('/p', '/e', {...asked, JOBADABRA_E2E: '1'});
  assert.ok(args.includes('--host-resolver-rules=MAP boards.greenhouse.io 127.0.0.1:5'));
  assert.ok(args.includes('--ignore-certificate-errors'));
  assert.ok(args.includes('--no-sandbox'), 'under e2e only: a CI runner may not allow the sandbox');
  assert.equal(browserArguments('/p', '/e', {}).includes('--no-sandbox'), false, 'a person\'s browser keeps its sandbox');
  assert.equal(args.some(arg => /proxy-server|remote-debugging-address/.test(arg)), false, 'nothing else is let through');
  assert.deepEqual(browserArguments('/p', '/e', {JOBADABRA_E2E: '1', JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: 'not json'}), browserArguments('/p', '/e', {}));
});

test('a cached CDP port is accepted only after the browser proves the exact owned profile', () => {
  assert.equal(verifiedDebugPort('12345\n/devtools/browser/a', ['--user-data-dir=/owned/profile'], '/owned/profile'), 12345);
  assert.equal(verifiedDebugPort('12345\n/devtools/browser/a', ['--user-data-dir=/someone/else'], '/owned/profile'), null);
  assert.equal(verifiedDebugPort('0\n/path', ['--user-data-dir=/owned/profile'], '/owned/profile'), null);
});

test('send runs one CDP command on the verified browser, targetSocket finds one page by id (LinkedIn jobs 2/3: cookies, new tab, its own address)', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bb-')), profile = path.join(folder, 'background-browser', 'profile');
  fs.mkdirSync(profile, {recursive: true});
  fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '4242\n/devtools/browser/x');
  const calls = [];
  const storage = {path: name => path.join(folder, name)};
  const answers = {'/json/version': {webSocketDebuggerUrl: 'ws://127.0.0.1:4242/devtools/browser/x'},
    '/json/list': [{id: 'A', type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:4242/devtools/page/A'}, {id: 'W', type: 'service_worker', webSocketDebuggerUrl: 'ws://127.0.0.1:4242/devtools/page/W'}]};
  const fetchImpl = async url => ({ok: true, json: async () => answers[new URL(url).pathname]});
  const command = async (socket, method, params) => {
    calls.push([socket, method, params]);
    return method === 'Browser.getBrowserCommandLine' ? {arguments: [`--user-data-dir=${profile}`]} : {targetId: 'A'};
  };
  const browser = createBackgroundBrowser(storage, {find: () => '/x', fetchImpl, command});
  assert.deepEqual(await browser.send('Target.createTarget', {url: 'about:blank'}), {targetId: 'A'});
  assert.deepEqual(calls.at(-1), ['ws://127.0.0.1:4242/devtools/browser/x', 'Target.createTarget', {url: 'about:blank'}]);
  assert.equal(await browser.targetSocket('A'), 'ws://127.0.0.1:4242/devtools/page/A');
  assert.equal(await browser.targetSocket('W'), null, 'only a page target is a tab');
  assert.equal(await browser.targetSocket('nope'), null);
  const other = createBackgroundBrowser(storage, {find: () => '/x', fetchImpl, command: async (socket, method) => ({arguments: ['--user-data-dir=/someone/else']})});
  await assert.rejects(other.send('Target.createTarget', {}), /another profile/, 'a browser that is not ours is never sent anything');
});

test('the owned browser is never disguised: no user-agent, fingerprint, stealth or automation-hiding flag, with or without the e2e map (LinkedIn jobs 2/3, owner: "never disguise a browser as a person")', () => {
  const disguise = /user-agent|useragent|stealth|fingerprint|disable-blink-features|AutomationControlled|webdriver|excludeSwitches|lang=|accept-lang|platform/i;
  for (const env of [{}, {JOBADABRA_E2E: '1', JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: JSON.stringify(['--user-agent=Mozilla/5.0', '--disable-blink-features=AutomationControlled', '--host-resolver-rules=MAP a 127.0.0.1:1'])}]) {
    assert.equal(browserArguments('/p', '/e', env).filter(arg => disguise.test(arg)).length, 0, JSON.stringify(browserArguments('/p', '/e', env).filter(arg => disguise.test(arg))));
  }
  assert.ok(browserArguments('/p', '/e').includes('--enable-automation'), 'it says what it is');
});

// Layer 2 (the app's own server, a fake extension, no browser, no window): the browser extension pairs with the app, the app sees it, and a lost pairing is repaired by pairing again.
// Job: serve stored answers
// Why (1 Nov 2026, owner: "We can build 10-20 more journeys. for the integrations"; Trello journey 36 "Install, pair and repair the browser extension" had only unit tests of the install and
// the gate): the app's real request listener (lib/server.js requestListener) is served on a free loopback port chosen by the OS, never 47111 (asserted), with a temp folder as its storage.
// The "extension" is plain fetch with the extension's Origin and Bearer token: what the real one sends (extension/flow.js). Nothing here opens Chrome or the owner's app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {check} from '../../lib/extension-gate.js';
import {EXTENSION_ID, extensionSeen, requestListener} from '../../lib/server.js';
import {extensionToken} from '../../lib/server-env.js';
import {createStorage} from '../../lib/storage.js';

const OWNER_APP_PORT = 47111;
const FROM_EXTENSION = {Origin: `chrome-extension://${EXTENSION_ID}`};

/** The app's server on a temp folder and a free port, closed when the test ends. -> {storage, base}. */
async function appServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-pairing-'));
  const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
  const server = http.createServer(requestListener(storage));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  assert.notEqual(port, OWNER_APP_PORT, `the test server is on ${OWNER_APP_PORT}, the port the owner's app may hold`);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return {storage, base: `http://127.0.0.1:${port}`};
}

const pair = (base, headers) => fetch(`${base}/extension/pair`, {headers});
const report = (base, token, extra = {}) => fetch(`${base}/extension/tabs`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...FROM_EXTENSION},
  body: JSON.stringify({urls: [], browser: 'pairing-test-browser', version: '9.9.9', ...extra})});
// The gate Apply asks, with no copy of the extension found on this machine's browsers (the folder search is the only thing stood in for).
const applyGate = () => check({find: () => [], seen: extensionSeen, folder: '/none'});

test('A web page cannot pair: only the Jobadabra extension is handed the app\'s token', async t => {
  const {storage, base} = await appServer(t);
  for (const [who, headers] of [['a web page', {Origin: 'https://evil.example'}], ['a program with no Origin', {}]]) {
    const answer = await pair(base, headers);
    const text = await answer.text();
    assert.equal(answer.status, 403, `${who} was not refused`);
    assert.ok(!text.includes(extensionToken(storage)), `${who} was handed the token`);
    assert.equal(JSON.parse(text).token, undefined, `${who} got a token field`);
  }
});

test('The extension pairs and reports its tabs: the app sees it, and Apply stops asking to install it', async t => {
  const {storage, base} = await appServer(t);
  assert.equal(applyGate()?.state, 'absent', 'the control: before any report, Apply asks to install the extension');

  const paired = await pair(base, FROM_EXTENSION);
  assert.equal(paired.status, 200);
  const {token} = await paired.json();
  assert.equal(token, extensionToken(storage), 'the app hands out its own token');

  const reported = await report(base, token);
  assert.equal(reported.status, 200, 'the paired extension\'s report was refused');
  assert.equal((await reported.json()).ok, true);
  assert.equal(extensionSeen()?.version, '9.9.9', 'the app did not see the extension that reported');
  assert.equal(extensionSeen()?.id, EXTENSION_ID, 'the app did not take the extension\'s id from its Origin');
  assert.equal(applyGate(), null, 'Apply is still blocked after the extension reported');
});

test('A lost pairing is repaired: the old token is refused, pairing again gives one that works', async t => {
  const {storage, base} = await appServer(t);
  const {token: old} = await (await pair(base, FROM_EXTENSION)).json();
  assert.equal((await report(base, old)).status, 200, 'the control: the first token works');

  // The app's pairing changes under the extension (a reset, a new install): the extension still holds the old token.
  storage.setSecret('EXTENSION_TOKEN', 'a-token-the-extension-has-never-seen');
  const refused = await report(base, old);
  assert.equal(refused.status, 401, 'the old token was still accepted');
  assert.equal((await refused.json()).ok, false);

  const {token: fresh} = await (await pair(base, FROM_EXTENSION)).json();
  assert.notEqual(fresh, old, 'pairing again handed out the old token');
  const again = await report(base, fresh);
  assert.equal(again.status, 200, 'the new token was refused');
  assert.equal((await again.json()).ok, true);
});

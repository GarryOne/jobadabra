// The Chrome Web Store copy of the extension has its own ID: the app pairs with it and opens its pages, not only the folder copy's.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';

const STORE = 'nmbnjhmpofifgcdalfefddbiihccogoi';    // chromewebstore.google.com/detail/jobadabra/nmbnjhmpofifgcdalfefddbiihccogoi
const FOLDER = 'gpffoneapcfceflfmfgedkcfbommgcfk';   // the manifest key's ID (Load unpacked)
const freePort = () => new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });

test('the store-installed extension pairs, and the app opens pages at the ID that last checked in', async () => {
  process.env.JOB_PILOTTO_PORT = String(await freePort());
  const server = await import('../lib/server.js');
  assert.deepEqual(server.EXTENSION_IDS, [FOLDER, STORE]);
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-store-id-')), {encrypt: s => s, decrypt: s => s});
  const running = server.start(storage, error => assert.fail(error));
  await new Promise(resolve => setTimeout(resolve, 100));
  const call = (url, origin, body = {}, token = '') => fetch(`http://127.0.0.1:${server.PORT}${url}`, {method: 'POST', body: JSON.stringify(body),
    headers: {Origin: origin, 'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}});
  try {
    const paired = await call('/extension/pair', `chrome-extension://${STORE}`);
    assert.equal(paired.status, 200, 'the Web Store copy gets the connection');
    assert.equal(paired.headers.get('access-control-allow-origin'), `chrome-extension://${STORE}`);
    const {token} = await paired.json();
    assert.ok(token);
    assert.equal((await call('/extension/pair', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop')).status, 403, 'any other extension is refused');

    assert.equal(server.extensionIdNow(), FOLDER, 'before any check-in: the folder copy');
    assert.equal((await call('/extension/tabs', `chrome-extension://${STORE}`, {urls: [], version: '0.9.620'}, token)).status, 200);
    assert.equal(server.extensionIdNow(), STORE, 'the store copy checked in: wake it, not the folder copy');
    await call('/extension/tabs', `chrome-extension://${FOLDER}`, {urls: [], version: '0.9.621'}, token);
    assert.equal(server.extensionIdNow(), FOLDER);
    await call('/extension/tabs', 'https://evil.example', {urls: []}, token);
    assert.equal(server.extensionIdNow(), FOLDER, 'an Origin we do not trust never becomes the ID');
  } finally { running?.close?.(); }
});

test('no app code opens an extension page at the fixed folder ID', () => {
  // A store user has no copy at that ID: pages open at the ID that checked in (server.extensionIdNow) or the one Chrome recorded.
  const lib = new URL('../lib/', import.meta.url);
  const fixed = fs.readdirSync(lib).filter(name => name.endsWith('.js'))
    .filter(name => /chrome-extension:\/\/\$\{(server\.)?EXTENSION_ID\}\//.test(fs.readFileSync(new URL(name, lib), 'utf8')));
  assert.deepEqual(fixed, []);
});

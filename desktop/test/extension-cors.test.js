// Every address the extension calls on the app answers Chrome's CORS preflight: an address without it fails for the extension's
// worker too (8 Oct 2026: /extension/site-password had none, so no sign-in password was ever filled).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';

const freePort = () => new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });
const extensionDir = new URL('../../extension/', import.meta.url);
const called = [...new Set(fs.readdirSync(extensionDir).filter(name => name.endsWith('.js'))
  .flatMap(name => [...fs.readFileSync(new URL(name, extensionDir), 'utf8').matchAll(/['`](\/extension\/[a-z-]+)/g)].map(match => match[1])))]
  .filter(url => url !== '/extension/pair');   // pairing answers only the extension's own origin, by its own test (automation.test.js)

test('every /extension address the extension calls answers the preflight from the extension', async () => {
  process.env.JOB_PILOTTO_PORT = String(await freePort());
  const server = await import('../lib/server.js');
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cors-')), {encrypt: s => s, decrypt: s => s});
  const running = server.start(storage, error => assert.fail(error));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(called.length > 20 && called.includes('/extension/site-password'), `found ${called.length} addresses`);
  const missing = [];
  try {
    for (const id of server.EXTENSION_IDS) for (const url of called) {
      const origin = `chrome-extension://${id}`;   // every ID we trust (the folder's and the Web Store's), not only the primary
      const answer = await fetch(`http://127.0.0.1:${server.PORT}${url}`, {method: 'OPTIONS', headers: {Origin: origin,
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'}});
      const allowed = answer.headers.get('access-control-allow-origin');
      if (!answer.ok || ![origin, '*'].includes(allowed) || !/authorization/i.test(answer.headers.get('access-control-allow-headers') || '')) missing.push(`${url} (${answer.status}, ${allowed})`);
    }
  } finally { running?.close?.(); }
  assert.deepEqual(missing, []);
});

// The app's server reports a taken extension port to its caller instead of crashing, tested on a port of its own: never the owner's app's 47111.
// Moved out of automation.test.js (30 Oct 2026): a test process never listens on 47111 (lib/server-listen.js testWithoutOwnPort), and lib/server.js reads its
// port when first imported, which that file's static imports did (lib/claude-session.js) before any line of it could choose another.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';

const freePort = () => new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });

test('a taken extension port is reported, not a crash', async () => {
  process.env.JOBADABRA_PORT = String(await freePort());
  const server = await import('../lib/server.js');
  assert.equal(String(server.PORT), process.env.JOBADABRA_PORT, 'this test holds its own port, never the owner\'s app\'s');
  const blocker = net.createServer();
  await new Promise(resolve => blocker.listen(server.PORT, '127.0.0.1', resolve));
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-port-')), {encrypt: s => s, decrypt: s => s});
  const error = await new Promise(resolve => server.start(storage, resolve));  // port busy: the blocker
  assert.equal(error.code, 'EADDRINUSE');
  blocker.close();
});

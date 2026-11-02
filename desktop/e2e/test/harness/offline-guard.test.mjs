// The e2e env of an app server under test (lib/offline-guard.mjs): it says it is the end-to-end journey (no telemetry, no pool sharing), keeps its data in its own
// folder, and the guard refuses any request that leaves this computer (fetch, http, https), naming the host; loopback is allowed.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {guardNetwork, offlineEnv} from '../../lib/offline-guard.mjs';

test('the env is the journey\'s, in its own folder, never the app\'s real one', () => {
  const env = offlineEnv('/tmp/jp-x', {PATH: '/bin', ANTHROPIC_API_KEY: 'sk-real', JOBADABRA_TWIN: '1'});
  assert.equal(env.JOBADABRA_E2E, '1');
  assert.equal(env.JOBADABRA_USER_DATA, '/tmp/jp-x');
  assert.equal(env.JOBADABRA_NO_DOTENV, '1');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.ANTHROPIC_API_KEY, undefined, 'no key on a Mac: the plan path only');
  assert.equal(env.JOBADABRA_TWIN, undefined);
  assert.throws(() => offlineEnv(path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto')), /real/);
});

test('a request that leaves this computer is refused and named; loopback goes through', async () => {
  const server = http.createServer((request, response) => response.end('ok'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const guard = guardNetwork();
  try {
    await assert.rejects(fetch('https://www.jobadabra.top/api/aliases'), /offline: www\.jobadabra\.top/);
    assert.throws(() => https.get('https://example.com/'), /offline: example\.com/);
    assert.throws(() => http.request({host: 'example.org', path: '/'}), /offline: example\.org/);
    assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text(), 'ok');
    assert.deepEqual(guard.refused, ['www.jobadabra.top', 'example.com', 'example.org']);
  } finally { guard.restore(); server.close(); }
  assert.notEqual(globalThis.fetch.name, 'offlineFetch', 'restore() puts the real fetch back');
});

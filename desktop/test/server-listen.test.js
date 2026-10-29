// The socket Chrome's extension reports to: a busy port is said and retried, and a test app never takes the production port (owner, 29 Oct 2026).
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {test} from 'node:test';
import {listen, listenState, linkOffOf, testWithoutOwnPort, unheardForms} from '../lib/server-listen.js';

const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => resolve(port)); }); });
const until = async (check, ms = 3000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };

test('the owner scenario: another program holds the port, the app says so once and takes the port when it frees up', async () => {
  const port = await freePort(), holder = http.createServer().listen(port, '127.0.0.1');
  await once(holder, 'listening');
  const said = [], server = http.createServer();
  listen(server, port, {env: {}, say: (area, line) => said.push(line), retryMs: 50});
  await until(() => listenState().ok === false);
  assert.deepEqual(linkOffOf(listenState()), {port, code: 'EADDRINUSE'}, 'the Sessions page is told the connection is off, and why');
  await new Promise(r => setTimeout(r, 200));   // several retries while it stays busy
  assert.equal(said.filter(line => /used by another program/.test(line)).length, 1, 'said once, not at each retry');
  await new Promise(r => holder.close(r));
  await until(() => listenState().ok === true);
  assert.equal(linkOffOf(listenState()), undefined);
  assert.ok(said.some(line => /connection back/.test(line)));
  await new Promise(r => server.close(r));
});

test('a test app without its own port does not listen at all; with one it does', async () => {
  assert.equal(testWithoutOwnPort({JOB_PILOTTO_E2E: '1'}), true);
  assert.equal(testWithoutOwnPort({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_PORT: 'abc'}), true);
  assert.equal(testWithoutOwnPort({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_PORT: '48123'}), false);
  assert.equal(testWithoutOwnPort({}), false, 'a person\'s app has the production port');
  const bare = http.createServer();
  listen(bare, await freePort(), {env: {JOB_PILOTTO_E2E: '1'}, say: () => {}});
  assert.equal(bare.listening, false);
  assert.equal(listenState().code, 'TEST_WITHOUT_PORT');
  const port = await freePort(), own = http.createServer();
  listen(own, port, {env: {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_PORT: String(port)}, say: () => {}});
  await once(own, 'listening');
  assert.equal(listenState().ok, true);
  await new Promise(r => own.close(r));
});

test('formsOpen while unheard: unknown, with linkOff only when our own socket is the reason', () => {
  assert.deepEqual(unheardForms({ok: true, port: 47111, code: ''}), {known: false, ids: []});
  assert.deepEqual(unheardForms({ok: null, port: 0, code: ''}), {known: false, ids: []}, 'not tried yet');
  assert.deepEqual(unheardForms({ok: false, port: 47111, code: 'EADDRINUSE'}), {known: false, ids: [], linkOff: {port: 47111, code: 'EADDRINUSE'}});
  assert.deepEqual(unheardForms({ok: false, port: 47111, code: 'TEST_WITHOUT_PORT'}), {known: false, ids: []}, 'a test app that chose not to listen has no card to show');
});

test('the owner is told once: onError is called for the first failure, not at each retry, and an error on an open socket is no "off"', async () => {
  const port = await freePort(), holder = http.createServer().listen(port, '127.0.0.1');
  await once(holder, 'listening');
  const errors = [], server = http.createServer();
  listen(server, port, {env: {}, say: () => {}, retryMs: 30, onError: error => errors.push(error.code)});
  await until(() => listenState().ok === false);
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(errors, ['EADDRINUSE']);
  await new Promise(r => holder.close(r));
  await until(() => listenState().ok === true);
  server.emit('error', Object.assign(new Error('late'), {code: 'ECONNRESET'}));
  assert.equal(listenState().ok, true, 'still open');
  await new Promise(r => server.close(r));
});

test('a listen error other than a busy port is said as itself and not retried (Gitar #2508: EACCES)', async () => {
  const {EventEmitter} = await import('node:events');
  const fake = Object.assign(new EventEmitter(), {listening: false, calls: 0, listen() { this.calls++; }});
  const said = [];
  listen(fake, 47111, {env: {}, say: (area, line) => said.push(line), retryMs: 10});
  fake.emit('error', Object.assign(new Error('denied'), {code: 'EACCES'}));
  await new Promise(r => setTimeout(r, 60));
  assert.equal(fake.calls, 1, 'no retry');
  assert.deepEqual(said, ['connection off: port 47111 could not be opened (EACCES)']);
  assert.deepEqual(linkOffOf(listenState()), {port: 47111, code: 'EACCES'});
});

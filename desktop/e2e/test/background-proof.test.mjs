// Exercise the hidden-browser diagnostic waits with CDP messages, without launching a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../lib/background-proof.mjs', import.meta.url), 'utf8');
const diagnostics = source.slice(source.indexOf('const consoleOf ='), source.indexOf('/** What the hidden browser'));
function load({reply = () => {}, read = () => '{}'} = {}) {
  const sockets = [];
  class Socket {
    constructor() { sockets.push(this); this.closed = false; }
    send(text) { queueMicrotask(() => reply(this, JSON.parse(text))); }
    close() { this.closed = true; }
    receive(message) { this.onmessage({data: JSON.stringify(message)}); }
  }
  const api = vm.runInNewContext(`${diagnostics}; ({consoleOf, askExtension})`, {
    WebSocket: Socket, setTimeout: (...args) => setTimeout(...args), clearTimeout: timer => clearTimeout(timer),
    fs: {readFileSync: read}, path, fetch: async () => ({json: async () => ({webSocketDebuggerUrl: 'ws://fixture'})}), AbortSignal,
  });
  return {...api, sockets};
}

test('console collection ends after both enable acknowledgements, retaining replayed events', async () => {
  const {consoleOf, sockets} = load();
  let ended = false;
  const result = consoleOf('ws://fixture').then(value => { ended = true; return value; });
  const socket = sockets[0];
  socket.onopen();
  socket.receive({method: 'Runtime.consoleAPICalled', params: {type: 'info', args: [{value: 'replayed'}]}});
  socket.receive({id: 1, result: {}});
  await setImmediate();
  assert.equal(ended, false);
  socket.receive({method: 'Log.entryAdded', params: {entry: {level: 'warning', text: 'stored'}}});
  socket.receive({id: 2, result: {}});
  await setImmediate();
  assert.equal(ended, true, 'acknowledgements finish collection without a settling delay');
  assert.equal(await result, 'info: replayed // log warning: stored');
  assert.equal(socket.closed, true);
});

test('an empty console completes on acknowledgements and a missing acknowledgement names the hang', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {consoleOf, sockets} = load();
  const empty = consoleOf('ws://fixture');
  sockets[0].receive({id: 1, result: {}});
  sockets[0].receive({id: 2, result: {}});
  assert.equal(await empty, '(empty)');
  const hung = assert.rejects(consoleOf('ws://fixture'), /never acknowledged Runtime.enable and Log.enable/);
  t.mock.timers.tick(10000);
  await hung;
  assert.equal(sockets[1].closed, true);
});

test('extension inspection polls document readiness before reading extension storage', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let ready = false, inspected = false;
  const {askExtension, sockets} = load({
    read: () => JSON.stringify({extensions: {settings: {abc: {path: '/fixture/background-browser/extension'}}}}),
    reply: (socket, {id, method, params}) => {
      let result = {};
      if (method === 'Target.createTarget') result = {targetId: 'target'};
      if (method === 'Target.attachToTarget') result = {sessionId: 'session'};
      if (method === 'Runtime.evaluate') {
        const polling = params.expression.startsWith('location.href');
        if (!polling) { assert.equal(ready, true); inspected = true; }
        result = {result: {value: polling ? ready : 'extension snapshot'}};
      }
      socket.receive({id, result});
    },
  });
  const answer = askExtension('/fixture', 1234);
  await setImmediate();
  sockets[0].onopen();
  await setImmediate();
  assert.equal(inspected, false);
  ready = true;
  t.mock.timers.tick(100);
  assert.equal(await answer, 'extension snapshot');
  assert.equal(sockets[0].closed, true);
});

test('an unresponsive extension closes its socket and reports the readiness hang cap', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {askExtension, sockets} = load({read: () => JSON.stringify({extensions: {settings: {abc: {path: '/fixture/background-browser/extension'}}}})});
  const answer = askExtension('/fixture', 1234);
  await setImmediate();
  sockets[0].onopen();
  t.mock.timers.tick(10000);
  assert.match(await answer, /extension options page never became ready or answered/);
  assert.equal(sockets[0].closed, true);
});

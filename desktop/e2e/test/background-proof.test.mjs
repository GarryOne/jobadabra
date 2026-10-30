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

test('the triage account stand-in reads login and account controls after the hidden-page observation', async () => {
  const {withAccountReadJudge} = await import('../lib/background-proof.mjs');
  const {INSTRUCTIONS} = await import('../../lib/form-judge.js');
  let observed = 0;
  const judge = withAccountReadJudge(() => 'other ask', 'Submit Application', async () => { observed++; });
  const ask = text => ({system: INSTRUCTIONS, messages: [{content: text}]});
  const login = JSON.parse(await judge(ask('Headings: Fixture job title | Sign in to apply\nControls: password · Password · required · empty')));
  assert.equal(observed, 1);
  assert.deepEqual([login.login_wall, login.account_to_create, login.bot_check], [true, false, false]);
  const account = JSON.parse(await judge(ask('Controls: password · Confirm password · required · empty')));
  assert.deepEqual([account.login_wall, account.account_to_create, account.bot_check], [false, true, false]);
  assert.equal(observed, 2);
  assert.equal(await judge({system: 'other question'}), 'other ask');
  assert.equal(observed, 2, 'only form-judge asks observe the hidden page');
});

test('the triage account stand-in retains bot-check and clean-form answers', async () => {
  const {withAccountReadJudge} = await import('../lib/background-proof.mjs');
  const {INSTRUCTIONS} = await import('../../lib/form-judge.js');
  const judge = withAccountReadJudge(null, 'Submit Application');
  const ask = text => ({system: INSTRUCTIONS, messages: [{content: text}]});
  assert.equal(JSON.parse(await judge(ask("checkbox · I'm not a robot · required · empty"))).bot_check, true);
  const clean = JSON.parse(await judge(ask('email · Email · required · empty')));
  assert.deepEqual([clean.login_wall, clean.account_to_create, clean.bot_check], [false, false, false]);
});

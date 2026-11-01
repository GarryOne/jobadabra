// Exercise the hidden-browser diagnostic waits with CDP messages, without launching a browser.
/* global window */
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

test('the app clock bridge moves the already loaded ESM clock through the Node inspector', async () => {
  const {Session} = await import('node:inspector');
  const {moveAppWaitClock} = await import('../lib/apply-hold.mjs');
  const module = new URL('../../lib/background-apply-clock.js', import.meta.url).href;
  const clock = await import(module), session = new Session(), previous = process.env.JOB_PILOTTO_E2E;
  process.env.JOB_PILOTTO_E2E = '1';
  session.connect();
  try {
    const dueAt = clock.backgroundWaitNow() + 60000;
    const reply = await new Promise((resolve, reject) => session.post('Runtime.evaluate', {
      expression: `(${moveAppWaitClock.toString()})(null, ${JSON.stringify({module, dueAt})})`, awaitPromise: true, returnByValue: true,
    }, (error, result) => error ? reject(error) : resolve(result)));
    assert.equal(reply.exceptionDetails, undefined);
    assert.ok(reply.result.value > dueAt);
    assert.ok(clock.backgroundWaitNow() >= reply.result.value, 'the inspector moved the app clock, not another module instance');
  } finally {
    session.disconnect();
    if (previous === undefined) delete process.env.JOB_PILOTTO_E2E; else process.env.JOB_PILOTTO_E2E = previous;
  }
});

test('the hidden worker command awaits its poll promise before reading the reply', async () => {
  let packet;
  class Socket {
    constructor() { queueMicrotask(() => this.onopen()); }
    send(text) { packet = JSON.parse(text); queueMicrotask(() => this.onmessage({data: JSON.stringify({id: 1, result: {result: {value: true}}})})); }
    close() {}
  }
  const begin = source.indexOf('export const evaluateOn ='), end = source.indexOf('/** The debugging port', begin);
  const evaluateOn = vm.runInNewContext(source.slice(begin, end).replace('export const', 'const') + '; evaluateOn;', {WebSocket: Socket, setTimeout, clearTimeout});
  assert.equal(await evaluateOn('ws://fixture', 'globalThis.__jobPilottoBackgroundSessions?.poll()'), true);
  assert.equal(packet.params.awaitPromise, true);
});

// Why (31 Oct 2026, re-check 41198629562, apply-2of3): the poll awaits the app's /extension/background-apply ([ext-http] 4.1 and 4.8 s there, no AI), and a 4 s
// cap on the whole evaluate timed the app's work, not the worker's reply. The step's hang cap is the strict poll's only clock (rule B).
test('the strict due-time poll has no clock of its own; a diagnostics read keeps its cap', async () => {
  class Socket {
    constructor() { queueMicrotask(() => this.onopen()); }
    send() { queueMicrotask(() => this.onmessage({data: JSON.stringify({id: 1, result: {result: {value: true}}})})); }
    close() {}
  }
  const begin = source.indexOf('export const evaluateOn ='), end = source.indexOf('/** The debugging port', begin);
  // A cap fires before the reply arrives, as a slow app request makes it on CI.
  const evaluateOn = vm.runInNewContext(source.slice(begin, end).replace('export const', 'const') + '; evaluateOn;', {WebSocket: Socket, setTimeout: fire => queueMicrotask(fire), clearTimeout: () => {}});
  assert.equal(await evaluateOn('ws://fixture', 'diagnostics()'), null, 'a diagnostics read still ends at its cap');
  const {pollOwnedBackground} = await import('../lib/apply-hold.mjs');
  assert.equal(await pollOwnedBackground('/fixture', {targets: async () => [{type: 'service_worker', url: 'chrome-extension://fixture/background-owned.js', webSocketDebuggerUrl: 'ws://fixture'}], evaluate: evaluateOn}), true);
});

test('a due-time proof requires a live worker and an acknowledged extension poll', async () => {
  const {pollOwnedBackground} = await import('../lib/apply-hold.mjs');
  await assert.rejects(() => pollOwnedBackground('/fixture', {targets: async () => []}), /no.*service worker/);
  for (const result of [null, false, undefined]) {
    await assert.rejects(() => pollOwnedBackground('/fixture', {targets: async () => [{type: 'service_worker', url: 'chrome-extension://fixture/background-owned.js', webSocketDebuggerUrl: 'ws://fixture'}], evaluate: async () => result}), /poll.*acknowledge/);
  }
  // A refused acknowledgement names what it asked: the reply and, per service worker, whether it has the poll (apply-3of3 41264415439 had neither).
  await assert.rejects(() => pollOwnedBackground('/fixture', {targets: async () => [{type: 'page', url: 'https://x'}, {type: 'service_worker', url: 'chrome-extension://fixture/background-owned.js', webSocketDebuggerUrl: 'ws://fixture'}],
    evaluate: async (_url, expression) => (expression.startsWith('typeof') ? false : undefined)}), /reply: null; asked chrome-extension:\/\/fixture\/background-owned\.js; service workers: chrome-extension:\/\/fixture\/background-owned\.js has the poll: false/);
  // A worker that does not answer the diagnostic read says so, never "null".
  await assert.rejects(() => pollOwnedBackground('/fixture', {targets: async () => [{type: 'service_worker', url: 'chrome-extension://fixture/background-owned.js', webSocketDebuggerUrl: 'ws://fixture'}], evaluate: async () => null}),
    /has the poll: unreadable \(no reply, closed or 4 s cap\)/);
  assert.equal(await pollOwnedBackground('/fixture', {targets: async () => [{type: 'service_worker', url: 'chrome-extension://fixture/background-owned.js', webSocketDebuggerUrl: 'ws://fixture'}], evaluate: async () => true}), true);
});

test('the due-time poll asks the owned extension\'s worker, whatever order the hidden browser lists its service workers in', async () => {
  const {pollOwnedBackground} = await import('../lib/apply-hold.mjs');
  const asked = [], worker = (name, url) => ({type: 'service_worker', url: `chrome-extension://${name}/${url}`, webSocketDebuggerUrl: `ws://${name}`});
  // apply-3of3 41267661024: thunk.js and another extension's background.js came before background-owned.js and have no poll.
  const targets = async () => [worker('nkeim', 'thunk.js'), worker('glbjn', 'background.js'), worker('gpffo', 'background-owned.js')];
  const evaluate = async url => { asked.push(url); return url === 'ws://gpffo'; };
  assert.equal(await pollOwnedBackground('/fixture', {targets, evaluate}), true);
  assert.deepEqual(asked, ['ws://gpffo'], 'a worker that is not the owned extension\'s was asked');
  await assert.rejects(() => pollOwnedBackground('/fixture', {targets: async () => [worker('nkeim', 'thunk.js')], evaluate}), /no.*owned service worker.*thunk\.js/);
});

test('advancePastDue rejects an app-only verdict and accepts a fresh extension verdict', async () => {
  const {advancePastDue} = await import('../lib/apply-hold.mjs');
  const at = 1000, record = {dueAt: 900, waitDecision: {at, state: 'needs_user_handoff', reason: 'stopped'}};
  const advance = vm.runInNewContext(advancePastDue.toString().replace('import.meta.url', JSON.stringify(new URL('../lib/apply-hold.mjs', import.meta.url).href)) + '; advancePastDue;', {
    URL, backgroundOf: async () => record, moveAppWaitClock: () => {}, pollOwnedBackground: async () => true,
    waitOn: async (_ctx, _seen, read, accepts) => {
      assert.equal(accepts(await read()), false, 'the app-only decision does not prove extension polling');
      record.waitDecision.via = 'extension';
      assert.equal(accepts(await read()), true);
      return record;
    },
  });
  await advance({page: {}, app: {evaluate: async () => at}, profile: '/fixture'}, {url: 'https://fixture'}, {}, {state: 'needs_user_handoff', reason: 'stopped'});
});

test('startJob requires an explicit wait for auto before seeding or saving anything', async () => {
  const {startJob} = await import('../lib/apply-hold.mjs');
  const ctx = {proxy: {canned: () => null}, page: {}};
  await assert.rejects(() => startJob(ctx, {mode: 'auto', seed: () => { throw new Error('seed must not run'); }}), /waitMin/);
});


test('the due-time CDP reader ignores events and other replies before its acknowledgement', async () => {
  const {evaluateOn} = await import('../lib/background-proof.mjs');
  const previous = globalThis.WebSocket;
  let socket;
  class Socket {
    constructor() { socket = this; queueMicrotask(() => this.onopen()); }
    send() {
      this.onmessage({data: JSON.stringify({method: 'Runtime.consoleAPICalled', params: {}})});
      this.onmessage({data: JSON.stringify({id: 2, result: {result: {value: false}}})});
      queueMicrotask(() => this.onmessage({data: JSON.stringify({id: 1, result: {result: {value: true}}})}));
    }
    close() { this.closed = true; }
  }
  globalThis.WebSocket = Socket;
  try {
    assert.equal(await evaluateOn('ws://fixture', 'poll()', {strict: true}), true);
    assert.equal(socket.closed, true);
  } finally { globalThis.WebSocket = previous; }
});

test('the due-time CDP reader reports worker exceptions and protocol errors', async () => {
  const {evaluateOn} = await import('../lib/background-proof.mjs');
  const previous = globalThis.WebSocket;
  try {
    for (const reply of [
      {result: {exceptionDetails: {exception: {description: 'Error: fixture poll refused'}}}},
      {error: {message: 'fixture target closed'}},
    ]) {
      globalThis.WebSocket = class {
        constructor() { queueMicrotask(() => this.onopen()); }
        send() { queueMicrotask(() => this.onmessage({data: JSON.stringify({id: 1, ...reply})})); }
        close() {}
      };
      await assert.rejects(evaluateOn('ws://fixture', 'poll()', {strict: true}), /fixture/);
      assert.equal(await evaluateOn('ws://fixture', 'poll()'), null, 'ordinary diagnostics retain their nonthrowing contract');
    }
  } finally { globalThis.WebSocket = previous; }
});

/** The app's session list as the proofs read it (window.pilot), driven from a plain page stand-in: evaluate(fn, arg) runs fn here. */
const appOf = sessions => {
  const skipped = [];
  globalThis.window = {pilot: {sessions: async () => sessions.filter(item => !skipped.includes(item.id)), sessionSkip: async id => { if (id === 'broken') throw new Error('refused'); skipped.push(id); }}};
  return {skipped, page: {evaluate: async (fn, arg) => fn(arg)}};
};

test('a step that throws ends the jobs it started before the error goes on; a step that finishes leaves them (rule 7)', async () => {
  const {withJobsEnded} = await import('../lib/background-proof.mjs');
  try {
    const sessions = [{id: 'a', url: 'https://x/a'}, {id: 'b', url: 'https://x/b'}, {id: 'c', url: 'https://x/c'}];
    const failing = appOf(sessions), boom = new Error('the poll did not acknowledge');
    await assert.rejects(() => withJobsEnded({page: failing.page, profile: '/fixture'}, [{url: 'https://x/a'}, {url: 'https://x/b'}], async () => { throw boom; }), error => error === boom);
    assert.deepEqual(failing.skipped, ['a', 'b'], 'the queued session of a job the failed step started stayed behind');
    assert.deepEqual((await failing.page.evaluate(() => window.pilot.sessions())).map(item => item.id), ['c'], 'a session of a job this step did not start was touched');

    const finished = appOf(sessions);
    assert.equal(await withJobsEnded({page: finished.page, profile: '/fixture'}, [{url: 'https://x/a'}], async () => 'applied'), 'applied');
    assert.deepEqual(finished.skipped, [], 'a finished step dismissed a job it had applied');

    const refused = appOf([{id: 'broken', url: 'https://x/a'}, {id: 'b', url: 'https://x/b'}]);
    await assert.rejects(() => withJobsEnded({page: refused.page, profile: '/fixture'}, [{url: 'https://x/a'}, {url: 'https://x/b'}], async () => { throw boom; }), error => error === boom, 'the original error was replaced');
    assert.deepEqual(refused.skipped, ['b'], 'one refused skip stopped the others');
  } finally { delete globalThis.window; }
});

test('a hang message leads with the hidden browser: the owned worker, its tabs and the app queue', async () => {
  const {hiddenBrief} = await import('../lib/background-proof.mjs');
  try {
    const {page} = appOf([{id: 'fa69757f', url: 'https://x/a', background: {state: 'waiting_to_submit'}}, {id: 'e45acca5', url: 'https://x/b'}]);
    const target = (type, url) => ({type, url});
    const withWorker = await hiddenBrief('/fixture', page, {targets: async () => [target('service_worker', 'chrome-extension://nkeim/thunk.js'), target('service_worker', 'chrome-extension://gpffo/background-owned.js'), target('page', 'https://jobs.example/apply?check=auto')]});
    assert.match(withWorker, /^hidden browser: owned worker yes; tabs: https:\/\/jobs\.example\/apply\?check=auto \| app queue: fa69757f:waiting_to_submit e45acca5:-$/);
    assert.match(await hiddenBrief('/fixture', page, {targets: async () => [target('service_worker', 'chrome-extension://nkeim/thunk.js')]}), /owned worker NO; tabs: none/);
    assert.match(await hiddenBrief('/fixture', page, {targets: async () => { throw new Error('no port'); }}), /hidden browser: not reachable \(no port\) \| app queue:/);
  } finally { delete globalThis.window; }
});

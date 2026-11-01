// A slow extension request says when it arrived, when it ended, and how long its AI calls waited for a CLI slot versus ran (nightly run 41162490590: 106 s before a page-kind answer, unlocated).
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {test} from 'node:test';
import {slots} from '../lib/ai/cli-base.js';
import {SLOW_MS, createConnections, noteAiLimiter, timed} from '../lib/ext-http-timing.js';
import {requestListener} from '../lib/server.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function request(url, handle, clock, {socket, connections, lines = []} = {}) {
  const res = new EventEmitter(), fired = [];
  const done = timed({url, socket}, res, handle, {log: (area, text) => lines.push(`[${area}] ${text}`), now: () => clock.at, after: (fn, ms) => { fired.push({fn, ms}); return fired.length; }, cancel: () => {}, connections});
  return {res, lines, fired, done};
}

test('a request open past 2 s writes "open" once, then "finish" with its elapsed time and its AI limiter wait and run time', async () => {
  const clock = {at: 1000}, ran = request('/extension/page-kind?url=https://x.test/job', async () => { noteAiLimiter(90000, 12000); noteAiLimiter(100, 50); }, clock);
  await ran.done;
  assert.equal(ran.fired[0].ms, SLOW_MS);
  clock.at = 3000; ran.fired[0].fn();
  clock.at = 107100; ran.res.emit('close');
  const id = ran.lines[0].match(/\] (\d+) /)[1];
  assert.deepEqual(ran.lines, [
    `[ext-http] ${id} /extension/page-kind phase=open elapsed_ms=2000`,
    `[ext-http] ${id} /extension/page-kind phase=finish elapsed_ms=106100 ai_queue_ms=90100 ai_run_ms=12050 ai_calls=2 accept_wait_ms=- handler_ms=106100 conns=0 held=none`,
  ]);
});

test('a request under 2 s writes nothing, and the query string (job addresses) never reaches the log', async () => {
  const clock = {at: 0}, ran = request('/extension/log?secret=1', async () => {}, clock);
  await ran.done;
  clock.at = 1999; ran.res.emit('close');
  assert.deepEqual(ran.lines, []);
  const slow = request('/extension/me?url=https://private.example/job', async () => {}, clock);
  clock.at = 5000; slow.fired[0].fn();
  assert.doesNotMatch(slow.lines.join('\n'), /private\.example|\?/);
});

test('the real CLI limiter reports a call\'s wait for a slot to the request it belongs to, per request', async () => {
  const queue = slots(1), clock = {at: 0}, outcomes = [];
  const first = request('/extension/page-kind', () => queue(() => pause(60)), clock);
  const second = request('/extension/page-kind', () => queue(() => pause(10)), clock);
  await Promise.all([first.done, second.done]);
  for (const ran of [first, second]) { clock.at = 5000; ran.res.emit('close'); outcomes.push(ran.lines.at(-1)); }
  const [a, b] = outcomes.map(line => Object.fromEntries([...line.matchAll(/(ai_\w+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)])));
  assert.ok(a.ai_queue_ms < 30 && a.ai_run_ms >= 50, `the first ran at once: ${JSON.stringify(a)}`);
  assert.ok(b.ai_queue_ms >= 45, `the second waited behind the first: ${JSON.stringify(b)}`);
  assert.ok(b.ai_run_ms < 50, `the second's run time excludes its wait: ${JSON.stringify(b)}`);
});

test('the app\'s real request listener times every request, and the response is unchanged', async () => {
  const clock = {at: 0}, lines = [], fired = [], res = Object.assign(new EventEmitter(), {head: null, text: '', writeHead(status) { this.head = status; }, end(chunk) { this.text = String(chunk ?? ''); }});
  const req = Object.assign((async function* () {})(), {url: '/extension/nothing-here?job=https://private.example/x', method: 'GET', headers: {}});
  const listener = requestListener({}, {log: (area, text) => lines.push(`[${area}] ${text}`), now: () => clock.at, after: (fn, ms) => { fired.push({fn, ms}); return 1; }, cancel: () => {}});
  await listener(req, res);
  assert.equal(fired[0]?.ms, SLOW_MS, 'the request was armed for the slow-request line');
  assert.ok(res.head >= 200, 'the handler still answered');
  clock.at = 7000; fired[0].fn(); res.emit('close');
  assert.match(lines.join('\n'), /\[ext-http\] \d+ \/extension\/nothing-here phase=open elapsed_ms=7000\n\[ext-http\] \d+ \/extension\/nothing-here phase=finish elapsed_ms=7000 ai_queue_ms=0/);
  assert.doesNotMatch(lines.join('\n'), /private\.example/);
});

// #2608: the reds' 23-38 s stalls wrote NO line above (handlers were fast), so the wait must be measured before the handler and next to the connections open then.
const socketAt = (connections, clock) => { const socket = new EventEmitter(); connections.opened(socket, clock.at); return socket; };

test('a request that waited 9 s between its connection being accepted and its handler starting writes one line with both numbers, the open connections and the routes holding them', async () => {
  const connections = createConnections(), clock = {at: 1000}, lines = [];
  const held = [socketAt(connections, clock), socketAt(connections, clock)];   // two long requests hold two of the extension's connections
  const holders = held.map((socket, i) => request(i ? '/extension/log?x=1' : '/extension/run', () => new Promise(() => {}), clock, {socket, connections, lines}));
  const late = socketAt(connections, clock);
  clock.at = 10000;   // 9 s later the new connection's request reaches the handler
  const ran = request('/extension/page-kind?url=https://private.example/job', async () => {}, clock, {socket: late, connections, lines});
  await ran.done;
  clock.at = 10300; ran.res.emit('close');
  const line = lines.find(text => text.includes('/extension/page-kind') && text.includes('phase=finish'));
  assert.match(line, /accept_wait_ms=9000 handler_ms=300 conns=3 held=\/extension\/log:1,\/extension\/run:1/);
  assert.doesNotMatch(lines.join('\n'), /private\.example|x=1/, 'route and timings only');
  assert.equal(holders.length, 2);
});

test('a fast request on a fresh connection writes nothing, and a reused connection reports no accept wait', async () => {
  const connections = createConnections(), clock = {at: 0}, lines = [], socket = socketAt(connections, clock);
  const first = request('/extension/log', async () => {}, clock, {socket, connections, lines});
  await first.done; clock.at = 100; first.res.emit('close');
  assert.deepEqual(lines, []);
  clock.at = 60000;   // minutes of keep-alive idle are not a wait
  const second = request('/extension/log', async () => {}, clock, {socket, connections, lines});
  await second.done; clock.at = 63000; second.res.emit('close');
  assert.match(lines.at(-1), /phase=finish elapsed_ms=3000 .*accept_wait_ms=- handler_ms=3000/);
});

test('on a real loopback server a connection seen at accept time gives the handler its real socket, and the line carries the wait', async () => {
  const connections = createConnections(), lines = [];
  const server = http.createServer(requestListener({}, {log: (area, text) => lines.push(`[${area}] ${text}`), now: () => 0, connections}));
  server.on('connection', socket => connections.opened(socket, -9000));   // accepted "9 s ago" by the fake clock
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/extension/nothing-here?token=secret`);
    await response.arrayBuffer();
    for (let i = 0; i < 50 && !lines.length; i++) await pause(10);
  } finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
  assert.match(lines.join('\n'), /\/extension\/nothing-here phase=finish elapsed_ms=0 .*accept_wait_ms=9000 handler_ms=0 conns=1 held=none/);
  assert.doesNotMatch(lines.join('\n'), /secret/);
});

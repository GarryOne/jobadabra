// extension/stop-state.js: the one debugger attachment is shared (spec 2026-10-16-report-from-the-trace.md §1): the form trace holds it, a menu click or typing attaches and detaches around its own work,
// and Chrome's detach happens only when the last user leaves, so the fill never ends the trace and the trace never leaves the bar up after the fill and the trace are done.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const calls = [];
globalThis.chrome = {
  storage: {session: {get: async key => ({[key]: true}), set: async () => {}, remove: async () => {}}},
  tabs: {get: async id => ({id, url: 'https://jobs.example.test/apply#jobadabra-fill'})},
  debugger: {attach: async target => { calls.push(['attach', target.tabId]); }, detach: async target => { calls.push(['detach', target.tabId]); }},
};
const {attachDebugger, debuggerUsers, detachDebugger, forgetDebuggerUsers} = await import('../../extension/stop-state.js');

test('three users share one attach; the last one out detaches', async () => {
  calls.length = 0;
  await attachDebugger(7);   // the trace
  await attachDebugger(7);   // a menu click
  await attachDebugger(7);   // the typing check
  assert.deepEqual(calls, [['attach', 7]], 'Chrome is asked once');
  await detachDebugger(7); await detachDebugger(7);
  assert.deepEqual(calls, [['attach', 7]], 'a click finishing never ends the trace');
  assert.equal(debuggerUsers(7), 1);
  await detachDebugger(7);
  assert.deepEqual(calls, [['attach', 7], ['detach', 7]]);
  await attachDebugger(7);
  assert.deepEqual(calls.at(-1), ['attach', 7], 'a new user attaches again');
  forgetDebuggerUsers(7);
  assert.equal(debuggerUsers(7), 0, 'Chrome let go by itself: nobody holds it');
});

test('tabs count apart', async () => {
  calls.length = 0;
  await attachDebugger(1); await attachDebugger(2);
  await detachDebugger(1);
  assert.deepEqual(calls, [['attach', 1], ['attach', 2], ['detach', 1]]);
  forgetDebuggerUsers();
});

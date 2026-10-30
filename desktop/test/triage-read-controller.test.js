// The controller's triage read: handed to the extension only when no application is open, answered through the same route, never a store row or a session (lib/background-apply-controller.js, lib/triage-reader.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../lib/background-apply-controller.js';
import {markedSession} from '../lib/session-tab.js';

const make = ({open = [], ready = true} = {}) => {
  const calls = [];
  const controller = createBackgroundApplyController({}, {
    store: {read: async () => null, queue: () => calls.push('store.queue'), claim: () => calls.push('store.claim')},
    browser: {ready: () => ready, start: async () => ({owner: 'o1'})},
    terminals: {list: () => open, byUrl: () => null, startForm: () => calls.push('terminals.startForm'), record: () => null, report: () => {}},
    config: () => ({}), log: () => {}, token: () => 'fictional', port: 1});
  return {controller, calls};
};
const poll = controller => controller.handle({action: 'poll', owner: 'o1'});

test('a queued read reaches the extension as a read command that carries the session mark, and its report resolves the read', async () => {
  const {controller, calls} = make(), pending = controller.triageRead({url: 'https://jobs.example.test/a'});
  const {jobs} = await poll(controller);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].mode, 'read');
  assert.equal(markedSession(jobs[0].url), jobs[0].session, 'the tab address names the read');
  assert.deepEqual((await poll(controller)).jobs, [], 'one read is out at a time');
  const answer = await controller.handle({action: 'triage-read', owner: 'o1', session: jobs[0].session, botCheck: false, loginWall: true, accountCreation: false});
  assert.deepEqual(answer, {ok: true});
  assert.deepEqual(await pending, {eligible: true, captcha: false, login: true, accountCreation: false, allFactsSaved: null});
  assert.deepEqual(calls, [], 'no store row, no session, no claim');
});

test('a read is never handed out while an application is open, and never starts beside one', async () => {
  const held = {id: 's1', url: 'https://jobs.example.test/held', background: {}};
  const {controller} = make({open: [held]});
  assert.equal(await controller.triageRead({url: 'https://jobs.example.test/b'}), null, 'refused at once, not queued');
  const {jobs} = await poll(controller);
  assert.deepEqual(jobs, []);
});

test('without the downloaded browser a read answers null and starts nothing', async () => {
  const {controller} = make({ready: false});
  assert.equal(await controller.triageRead({url: 'https://jobs.example.test/c'}), null);
});

test('a report from another owner or for another session changes nothing', async () => {
  const {controller} = make(), pending = controller.triageRead({url: 'https://jobs.example.test/d'});
  const {jobs} = await poll(controller);
  assert.deepEqual(await controller.handle({action: 'triage-read', owner: 'stranger', session: jobs[0].session, botCheck: false}), {ok: false});
  assert.deepEqual(await controller.handle({action: 'triage-read', owner: 'o1', session: 'other', botCheck: false}), {ok: false});
  controller.cancelTriage();
  assert.equal(await pending, null);
});

test('Cancel ends a read that is out', async () => {
  const {controller} = make(), pending = controller.triageRead({url: 'https://jobs.example.test/e'});
  await poll(controller);
  assert.equal(controller.cancelTriage(), 1);
  assert.equal(await pending, null);
});

test('Cancel tells the extension to close the page of the read it ended, once (#2624)', async () => {
  const {controller} = make(), pending = controller.triageRead({url: 'https://jobs.example.test/f'});
  const {jobs} = await poll(controller);
  controller.cancelTriage();
  await pending;
  assert.deepEqual((await poll(controller)).closes, [{session: jobs[0].session}], 'the poll names the read to close');
  assert.deepEqual((await poll(controller)).closes, [], 'and only once');
});

test('an application waits for a read that is out, and is claimed on the next poll once the read ended', async () => {
  const queued = {id: 's2', url: 'https://jobs.example.test/q', background: {}};
  let open = [], claims = 0;
  const controller = createBackgroundApplyController({}, {
    store: {read: async () => ({session: 's2', state: 'queued', mode: 'background'}), claim: async () => { claims += 1; return {ok: true, state: {mode: 'background'}}; }},
    browser: {ready: () => true, start: async () => ({owner: 'o1'})},
    terminals: {list: () => open, byUrl: () => null, record: () => null, report: () => {}},
    config: () => ({mode: 'background'}), log: () => {}, token: () => 'fictional', port: 1});
  const pending = controller.triageRead({url: 'https://jobs.example.test/a'});
  assert.equal((await poll(controller)).jobs[0].mode, 'read', 'the read is out');
  open = [queued];   // the person starts an application while the read is out
  assert.deepEqual((await poll(controller)).jobs, [], 'no claim and no second read while a read is out');
  assert.equal(claims, 0);
  controller.cancelTriage();
  await pending;
  assert.deepEqual((await poll(controller)).jobs.map(job => job.session), ['s2'], 'the application starts once the read ended');
  assert.equal(claims, 1);
});

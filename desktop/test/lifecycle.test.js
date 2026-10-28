// Exercise the actual lifecycle callbacks with fake Electron and pipeline services.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {claimInstance, startWhenReady, installQuitHandling} from '../lib/lifecycle.js';

function fixture({choice = 0, busy = {kind: 'search'}, queue = [], sessions = [], listed = [], important = [], importantDone = Promise.resolve(), platform = 'darwin', ask = false, demo = false, smoke = false, dataJob = false} = {}) {
  const calls = [], handlers = {};
  let drain, timeout;
  const idle = new Promise(resolve => { drain = resolve; });
  const app = {on: (event, fn) => { handlers[event] = fn; }, quit: () => calls.push('quit')};
  const storage = {settings: () => ({}), saveSettings: patch => calls.push(patch)};
  const window = {show: () => calls.push('show'), isDestroyed: () => false};
  const beforeQuit = installQuitHandling({app, platform, state: () => ({storage, window, demo, smoke}),
    pipeline: {running: () => busy, queued: () => queue, taskName: () => 'Search', freezeQueue: value => { assert.equal(value, storage); calls.push('freeze'); },
      stopRunning: () => calls.push('stop'), whenIdle: () => idle},
    terminals: {running: () => sessions, list: () => listed, label: () => 'Company', shutdown: () => calls.push('shutdown')},
    critical: {labels: () => important, whenDone: () => importantDone},
    dataRunning: () => dataJob, stopDataJob: () => { calls.push('stop-data'); dataJob = false; return Promise.resolve(); },
    shouldAskOnQuit: () => ask, askWhyLeaving: () => calls.push('ask'),
    showDialog: (_parent, options) => { calls.push(options.buttons); return choice; }, icon: () => ({}), getWindows: () => [window],
    toWindow: (...args) => calls.push(args), notify: (...args) => calls.push(args), onCancel: () => calls.push('cancelled'), later: (fn, ms) => { timeout = fn; assert.equal(ms, 300000); },
  });
  return {app, handlers, calls, drain, idle, timeout: () => timeout(), quit: () => beforeQuit({preventDefault: () => calls.push('prevent')})};
}

test('quit when done notifies, waits for idle, and allows the final quit without prompting again', async () => {
  const f = fixture(); f.quit();
  assert.ok(f.calls.some(value => Array.isArray(value) && value[0] === 'Jobadabra will quit when done'));
  assert.ok(!f.calls.includes('quit'));
  f.drain(); await f.idle; await new Promise(resolve => setImmediate(resolve));   // it also waits for important work (none here)
  assert.equal(f.calls.at(-1), 'quit');
  const count = f.calls.length; f.quit(); assert.equal(f.calls.length, count);
});
test('quit now freezes the queue before stopping work; cancel does neither', () => {
  const f = fixture({choice: 1}); f.quit(); assert.deepEqual(f.calls.slice(-3), ['freeze', 'stop', 'quit']);
  const cancel = fixture({choice: 2}); cancel.quit(); assert.ok(!cancel.calls.includes('quit')); assert.ok(!cancel.calls.includes('stop'));
});
test('quit now, and any other quit (will-quit), stop a running data job and wait for it before the app goes', async () => {
  const now = fixture({choice: 1, dataJob: true}); now.quit();
  assert.ok(!now.calls.includes('quit')); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(now.calls.slice(-3), ['stop', 'stop-data', 'quit']);
  // an unasked quit (update install, last window closed): will-quit holds until the job is gone, then quits again
  const other = fixture({busy: null, dataJob: true}); let prevented = false;
  other.handlers['will-quit']({preventDefault: () => { prevented = true; }});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true); assert.deepEqual(other.calls.slice(-2), ['stop-data', 'quit']);
  other.handlers['will-quit']({preventDefault: () => assert.fail('the second pass must go through')});
  assert.ok(other.calls.includes('shutdown'));
  const idle = fixture({busy: null}); idle.handlers['will-quit']({preventDefault: () => assert.fail('no job, no hold')});
});
test('sessions-only keep opens the running session; stop quits; waiting sessions do not block', () => {
  const sessions = [{id: 's1', status: 'running'}];
  const keep = fixture({busy: null, sessions}); keep.quit(); assert.deepEqual(keep.calls.at(-1), ['session', 'open', {id: 's1'}]);
  const stop = fixture({busy: null, sessions, choice: 1}); stop.quit(); assert.equal(stop.calls.at(-1), 'quit');
  const waiting = fixture({busy: null, sessions: [{id: 's1', status: 'input'}]}); waiting.quit(); assert.deepEqual(waiting.calls, []);
});
test('setup feedback is asked before quit and the timeout quits; demo and smoke bypass prompts', () => {
  const f = fixture({ask: true}); f.quit(); assert.ok(f.calls.includes('ask')); assert.ok(f.calls.some(value => value?.leaveAsked)); f.timeout(); assert.equal(f.calls.at(-1), 'quit');
  for (const options of [{demo: true}, {smoke: true}]) { const bypass = fixture(options); bypass.quit(); assert.deepEqual(bypass.calls, []); }
});
test('window close quits on Windows only; terminal shutdown runs on will-quit', () => {
  for (const platform of ['darwin', 'win32']) {
    const f = fixture({platform}); f.handlers['window-all-closed'](); assert.equal(f.calls.includes('quit'), platform === 'win32');
    f.handlers['will-quit'](); assert.equal(f.calls.at(-1), 'shutdown');
  }
});
test('instance ownership and ready/activate callbacks preserve startup ordering', async () => {
  const handlers = {}, calls = []; let window = null, ready = false;
  const app = {requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), isReady: () => ready,
    on: (event, fn) => { handlers[event] = fn; }, quit: () => calls.push('quit')};
  const createWindow = () => { calls.push('create'); window = {isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus')}; };
  const firstCopy = claimInstance({app, showDuplicate: () => calls.push('duplicate'), getWindow: () => window, createWindow});
  handlers['second-instance'](); assert.deepEqual(calls, []);
  await startWhenReady({app, firstCopy, start: () => calls.push('start'), getWindows: () => window ? [window] : [], createWindow});
  assert.deepEqual(calls, ['start']); ready = true; handlers['second-instance']();
  assert.deepEqual(calls.slice(-4), ['create', 'restore', 'show', 'focus']);
  handlers.activate(); assert.equal(calls.filter(value => value === 'create').length, 1);
  window = null; handlers.activate(); assert.equal(calls.at(-1), 'create');
  app.requestSingleInstanceLock = () => false;
  assert.equal(claimInstance({app, showDuplicate: () => calls.push('duplicate'), getWindow: () => window, createWindow}), false);
  await Promise.resolve(); assert.deepEqual(calls.slice(-2), ['duplicate', 'quit']);
});
test('moving the app does not install activation callbacks or start a second instance', async () => {
  const handlers = {}; let starts = 0;
  const app = {whenReady: () => Promise.resolve(), on: (name, fn) => { handlers[name] = fn; }};
  await startWhenReady({app, firstCopy: false, start: () => { starts++; }});
  await startWhenReady({app, firstCopy: true, start: () => { starts++; return false; }});
  assert.equal(starts, 1); assert.deepEqual(handlers, {});
});

test('an export alone still asks before quitting, and Quit when done waits for it (6 Oct 2026: the app closed mid-export)', async () => {
  let finish;
  const exporting = new Promise(resolve => { finish = resolve; });
  const f = fixture({busy: null, important: ['Exporting your data'], importantDone: exporting});
  f.drain(); f.quit();
  assert.ok(f.calls.includes('prevent'));
  assert.ok(f.calls.some(value => Array.isArray(value) && value[0] === 'Quit when done'));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!f.calls.includes('quit'), 'not before the export is done');
  finish(); await exporting; await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.at(-1), 'quit');
  const cancel = fixture({busy: null, important: ['Exporting your data'], choice: 2}); cancel.quit();
  assert.ok(!cancel.calls.includes('quit'));
});
test('both ways of staying (Cancel, keep sessions) tell the restart to stand down; stopping or quitting does not', () => {
  assert.ok(fixture({choice: 2}).quit() === undefined);
  const cancel = fixture({choice: 2}); cancel.quit(); assert.ok(cancel.calls.includes('cancelled'));
  const keep = fixture({busy: null, sessions: [{id: 's1', status: 'running'}]}); keep.quit(); assert.ok(keep.calls.includes('cancelled'));
  const now = fixture({choice: 1}); now.quit(); assert.ok(!now.calls.includes('cancelled'));
});

// Why (2026-10-28, owner: "Always close it but show that popup about the user confirming the quit considering there are active processes running"): a hidden-browser job has no terminal, so only its background state says it works.
test('quit with only an application filling in the hidden browser asks first; a finished or waiting-for-review one does not', () => {
  const job = state => ({id: 'a', kind: 'form', status: 'done', company: 'Air France', background: {state}});
  for (const state of ['queued', 'preflight', 'filling', 'waiting_to_submit', 'submitting']) {
    const f = fixture({busy: null, listed: [job(state)]}); f.quit();
    assert.deepEqual(f.calls.filter(Array.isArray).at(0), ['Keep working', 'Stop and quit'], `${state} asks`);
    assert.ok(!f.calls.includes('quit'), `${state} waits for the answer`);
  }
  for (const state of ['ready_for_review', 'needs_user_handoff', 'receipt_confirmed']) {
    const f = fixture({busy: null, listed: [job(state)]}); f.quit();
    assert.ok(!f.calls.includes('prevent'), `${state} quits without asking`);
  }
});

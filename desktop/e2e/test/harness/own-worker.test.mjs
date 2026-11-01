// The harness finds our extension's service worker by its URL, never by position (apply-3of3 41267661024: a Chrome component's thunk.js was listed first and had no poll).
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {extensionWorker, ownedWorkerOf} from '../../lib/own-worker.mjs';

const target = (id, file) => ({type: 'service_worker', url: `chrome-extension://${id}/${file}`, webSocketDebuggerUrl: `ws://${id}`});
/** A Playwright worker: its URL and what its own manifest says (`name`; null = the worker cannot be read). */
const worker = (id, file, name = id === 'ours' ? 'Jobadabra' : 'Other extension') => ({url: () => `chrome-extension://${id}/${file}`, id, evaluate: async () => { if (name === null) throw new Error('worker not ready'); return name; }});
/** A Playwright-like context: a list of workers and the 'serviceworker' event. */
const contextOf = workers => Object.assign(new EventEmitter(), {serviceWorkers: () => workers});

test('the owned worker is found with foreign service workers listed first', () => {
  const targets = [{type: 'page', url: 'https://x'}, target('nkeim', 'thunk.js'), target('glbjn', 'background.js'), target('gpffo', 'background-owned.js')];
  assert.equal(ownedWorkerOf(targets).webSocketDebuggerUrl, 'ws://gpffo');
  assert.equal(ownedWorkerOf([...targets].reverse()).webSocketDebuggerUrl, 'ws://gpffo', 'the order of the list does not matter');
});

test('no owned worker: the failure names every service worker it saw, and guesses none', () => {
  assert.throws(() => ownedWorkerOf([target('nkeim', 'thunk.js'), target('glbjn', 'background.js'), {type: 'page', url: 'https://x'}]),
    /no owned service worker.*nkeim\/thunk\.js \| chrome-extension:\/\/glbjn\/background\.js$/);
  assert.throws(() => ownedWorkerOf([]), /seen: none$/);
});

test("a Playwright context gives the extension's worker even when a foreign thunk.js AND a foreign background.js are listed first", async () => {
  const ours = worker('ours', 'background.js');
  assert.equal(await extensionWorker(contextOf([worker('nkeim', 'thunk.js'), worker('glbjn', 'background.js'), ours])), ours);
  assert.equal(await extensionWorker(contextOf([ours, worker('glbjn', 'background.js')])), ours, 'the order does not matter');
});

test('a worker that is not listed yet is taken from its own creation event, not from the foreign one that is', async () => {
  const context = contextOf([worker('nkeim', 'thunk.js')]), ours = worker('ours', 'background.js');
  const waiting = extensionWorker(context, {timeout: 5000});
  context.emit('serviceworker', worker('other', 'thunk.js'));   // a foreign worker's event does not answer
  context.emit('serviceworker', worker('glbjn', 'background.js'));   // nor does another extension's background.js
  context.emit('serviceworker', ours);
  assert.equal(await waiting, ours);
  assert.equal(context.listenerCount('serviceworker'), 0, 'the listener was left behind');
});

test('no extension worker in time: the failure names every worker seen', async () => {
  const context = contextOf([worker('nkeim', 'thunk.js'), worker('glbjn', 'background.js'), worker('slow', 'background.js', null)]);
  await assert.rejects(() => extensionWorker(context, {timeout: 50}),
    /no extension service worker of "Jobadabra" within 50 ms among the service workers seen: chrome-extension:\/\/nkeim\/thunk\.js not a background\.js \| chrome-extension:\/\/glbjn\/background\.js manifest "Other extension" \| chrome-extension:\/\/slow\/background\.js unreadable \(worker not ready\)$/);
  assert.equal(context.listenerCount('serviceworker'), 0, 'the listener was left behind');
});

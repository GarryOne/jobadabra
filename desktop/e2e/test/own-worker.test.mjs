// The harness finds our extension's service worker by its URL, never by position (apply-3of3 41267661024: a Chrome component's thunk.js was listed first and had no poll).
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {extensionWorker, ownedWorkerOf} from '../lib/own-worker.mjs';

const target = (id, file) => ({type: 'service_worker', url: `chrome-extension://${id}/${file}`, webSocketDebuggerUrl: `ws://${id}`});
const worker = (id, file) => ({url: () => `chrome-extension://${id}/${file}`, id});
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

test("a Playwright context gives the extension's worker even when a foreign one is listed first", async () => {
  const ours = worker('ours', 'background.js');
  assert.equal(await extensionWorker(contextOf([worker('nkeim', 'thunk.js'), ours])), ours);
});

test('a worker that is not listed yet is taken from its own creation event, not from the foreign one that is', async () => {
  const context = contextOf([worker('nkeim', 'thunk.js')]), ours = worker('ours', 'background.js');
  const waiting = extensionWorker(context, {timeout: 5000});
  context.emit('serviceworker', worker('other', 'thunk.js'));   // a foreign worker's event does not answer
  context.emit('serviceworker', ours);
  assert.equal(await waiting, ours);
  assert.equal(context.listenerCount('serviceworker'), 0, 'the listener was left behind');
});

test('no extension worker in time: the failure names every worker seen', async () => {
  const context = contextOf([worker('nkeim', 'thunk.js')]);
  await assert.rejects(() => extensionWorker(context, {timeout: 20}), /no extension service worker .* within 20 ms among the service workers seen: chrome-extension:\/\/nkeim\/thunk\.js$/);
  assert.equal(context.listenerCount('serviceworker'), 0, 'the listener was left behind');
});

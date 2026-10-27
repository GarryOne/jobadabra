// The app's Stop (owner, 13 Oct 2026: "a stop button for everything"): the person presses Stop in the app, and the extension hears it in the answer to its next report (review or tabs)
// until it says it has stopped (extension/stop.js stopFromApp, lib/server.js). A pressed Stop is never lost, never repeated after it was heard, and marks every live application "Stopped".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as terminals from '../lib/terminals.js';
import {journeyStep} from '../lib/application-journey.js';
import {startForm, stopLiveForms} from '../lib/stop-all.js';

const freePort = () => new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });

test('the extension hears the app\'s Stop in its next report, until it says it stopped', async () => {
  process.env.JOB_PILOTTO_PORT = String(await freePort());
  const server = await import('../lib/server.js');
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-stop-')), {encrypt: s => s, decrypt: s => s});
  const heard = [];
  server.setReviewHandler(() => ({matched: null, watch: [], commands: []}));
  server.setStoppedHandler(event => { heard.push(event.reason); });
  const running = server.start(storage, error => assert.fail(error));
  await new Promise(resolve => setTimeout(resolve, 100));
  const post = async (route, body = {}) => (await fetch(`http://127.0.0.1:${server.PORT}${route}`, {method: 'POST', headers: {Authorization: `Bearer ${server.extensionToken(storage)}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json();
  try {
    assert.equal((await post('/extension/review')).stop, undefined, 'no Stop pressed: nothing to hear');
    const request = server.requestStop();
    assert.ok(request, 'the request has an id');
    assert.equal((await post('/extension/review')).stop, request);
    assert.equal((await post('/extension/tabs', {urls: [], ids: []})).stop, request, 'a tab with no panel hears it from the 30 s report');
    assert.equal((await post('/extension/review')).stop, request, 'asked again until it is heard');
    await post('/extension/event', {type: 'stopped', reason: 'Stop pressed in the app'});
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(heard, ['Stop pressed in the app']);
    assert.equal((await post('/extension/review')).stop, undefined, 'heard: not asked again');
    assert.notEqual(server.requestStop(), request, 'a second Stop is a new request');
  } finally { running?.close?.(); }
});

test('a stopped extension marks every live application "Stopped", whatever step it was at, and says what to press', () => {
  terminals._reset();
  terminals.startForm({id: 'a1', url: 'https://jobs.example.test/a', company: 'A'});
  terminals.startForm({id: 'a2', url: 'https://jobs.example.test/b', company: 'B'});
  terminals.setStage('a2', 'account', 'auth.example.test');
  terminals.noteStuck('a2', 'account', 'auth.example.test', 'Choose a password');
  assert.equal(stopLiveForms(terminals), 2);
  for (const id of ['a1', 'a2']) {
    assert.equal(terminals.get(id).stuck, 'stopped', id);
    assert.match(journeyStep(terminals.get(id)).needs, /Stopped.*Reopen form/s, id);
  }
  assert.equal(stopLiveForms(terminals), 0, 'already said');
  terminals.clearStuck('a1');   // the person pressed Apply again: the fill's first report clears it (session-flow reported)
  assert.equal(terminals.get('a1').stuck, '');
});

// 27 Oct 2026: the app's card still said "You stopped the extension" while the person's Check form again filled the form.
test('the person\'s start on a tab takes that tab\'s session out of "Stopped"; other stopped sessions stay stopped', () => {
  terminals._reset();
  terminals.startForm({id: 'b1', url: 'https://jobs.example.test/a', company: 'A'});
  terminals.startForm({id: 'b2', url: 'https://jobs.example.test/b', company: 'B'});
  assert.equal(stopLiveForms(terminals), 2);
  const tabs = {11: 'b1', 12: 'b2'}, sessionOfTab = tab => tabs[tab] || '';
  assert.equal(startForm(terminals, sessionOfTab, 11), 'b1');
  assert.equal(terminals.get('b1').stuck, '', 'started again');
  assert.equal(terminals.get('b2').stuck, 'stopped', 'its page is still stopped');
  assert.equal(startForm(terminals, sessionOfTab, 11), '', 'not stopped any more: nothing to do');
  assert.equal(startForm(terminals, sessionOfTab, 99), '', 'a tab no session follows');
  terminals.noteStuck('b2', 'no-form');
  assert.equal(terminals.get('b2').stuck, 'stopped', 'control: a page report never lifts Stop (invariant 8)');
});

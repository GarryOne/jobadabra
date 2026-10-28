// lib/cdp-session.js: a lasting CDP connection shaped like Playwright's CDPSession, loopback only. A fake socket, no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openCdpSession} from '../lib/cdp-session.js';

class FakeSocket extends EventTarget {
  static last = null;
  constructor(url) { super(); this.url = url; this.sent = []; FakeSocket.last = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
  send(text) { this.sent.push(JSON.parse(text)); }
  reply(row) { const event = new Event('message'); event.data = JSON.stringify(row); this.dispatchEvent(event); }
  close() { this.dispatchEvent(new Event('close')); }
}

test('commands get their own answers and events reach their listeners', async () => {
  const cdp = await openCdpSession('ws://127.0.0.1:9222/devtools/page/A', {WebSocketClass: FakeSocket});
  const socket = FakeSocket.last, frames = [];
  cdp.on('Page.screencastFrame', params => frames.push(params.data));
  const first = cdp.send('Page.captureScreenshot', {format: 'jpeg'}), second = cdp.send('Page.enable');
  socket.reply({id: socket.sent[1].id, result: {}});
  socket.reply({id: socket.sent[0].id, result: {data: 'jpeg'}});
  socket.reply({method: 'Page.screencastFrame', params: {data: 'f1'}});
  assert.deepEqual(await first, {data: 'jpeg'});
  assert.deepEqual(await second, {});
  assert.deepEqual(frames, ['f1']);
  const refused = cdp.send('DOM.setFileInputFiles');
  socket.reply({id: socket.sent[2].id, error: {message: 'No node'}});
  await assert.rejects(refused, /refused/);
});

test('a closed connection fails what waits and every later command; a non-loopback address never opens', async () => {
  const cdp = await openCdpSession('ws://localhost:9222/devtools/page/B', {WebSocketClass: FakeSocket});
  const pending = cdp.send('Page.enable');
  FakeSocket.last.close();
  await assert.rejects(pending, /closed/);
  await assert.rejects(cdp.send('Page.enable'), /closed/);
  await assert.rejects(openCdpSession('ws://10.0.0.2:9222/devtools/page/C', {WebSocketClass: FakeSocket}), /loopback/);
});

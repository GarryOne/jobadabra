// The live view's core (hosted/ready-fill/live.mjs attachLive): frames out and the person's input in over a plain message channel (any client:
// the Mac app's screen now, a phone later), with the two bridges a hidden browser needs (B0, 28 Oct 2026): a native dropdown's list drawn by the
// viewer, and a file the app resolves. Nothing here presses anything on its own. Fakes only: no browser, no page, no file outside the test's folder.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attachLive} from '../../hosted/ready-fill/live.mjs';

function fakes({nodeAt = () => null} = {}) {
  const sent = [], calls = [], handlers = new Map();
  let onMessage = null, onClose = null;
  const channel = {send: message => sent.push(message), onMessage: fn => { onMessage = fn; }, onClose: fn => { onClose = fn; }};
  const objects = new Map();
  const cdp = {
    on: (event, fn) => handlers.set(event, fn),
    detach: async () => calls.push(['detach']),
    send: async (method, params = {}) => {
      calls.push([method, params]);
      if (method === 'Page.captureScreenshot') return {data: 'first-jpeg'};
      if (method === 'DOM.getNodeForLocation') { const node = nodeAt(params.x, params.y); return node ? {backendNodeId: node.id} : {}; }
      if (method === 'DOM.resolveNode') { objects.set(`obj-${params.backendNodeId}`, params.backendNodeId); return {object: {objectId: `obj-${params.backendNodeId}`}}; }
      if (method === 'Runtime.callFunctionOn') {
        const node = nodeAt.byId?.(objects.get(params.objectId));
        if (/closest\('select'\)/.test(params.functionDeclaration)) return {result: node?.select ? {objectId: params.objectId} : {subtype: 'null'}};
        if (/options\]\.map/.test(params.functionDeclaration)) return {result: {value: node.select}};
        return {result: {value: true}};
      }
      return {};
    },
  };
  return {channel, cdp, sent, calls, emit: (event, params) => handlers.get(event)?.(params), message: m => onMessage(m), close: () => onClose()};
}

const select = {id: 7, select: {label: 'Country', value: 'alpha', options: [{value: 'alpha', label: 'Alpha', disabled: false}, {value: 'gamma', label: 'Gamma', disabled: false}]}};
const at = (node) => Object.assign((x, y) => (x === 50 && y === 30 ? node : null), {byId: id => (id === node.id ? node : null)});

test('frames go out as plain messages, each acknowledged; the first is a screenshot at once', async () => {
  const f = fakes();
  await attachLive(f.channel, f.cdp);
  assert.deepEqual(f.sent[0].kind, 'first');
  await f.emit('Page.screencastFrame', {data: 'jpeg-1', sessionId: 3});
  assert.equal(f.sent.at(-1).kind, 'frame');
  assert.equal(f.sent.at(-1).data, 'jpeg-1');
  assert.ok(f.calls.some(([method, params]) => method === 'Page.screencastFrameAck' && params.sessionId === 3));
  assert.ok(f.calls.some(([method, params]) => method === 'Page.setInterceptFileChooserDialog' && params.enabled === true));
});

test('the person\'s mouse and keys reach the page; anything else never does', async () => {
  const f = fakes();
  await attachLive(f.channel, f.cdp);
  await f.message({t: 'mouse', type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1, buttons: 1});
  await f.message({t: 'key', key: 'a', text: 'a'});
  await f.message({t: 'eval', code: 'location="https://x.test"'});
  const input = f.calls.filter(([method]) => method.startsWith('Input.')).map(([method]) => method);
  assert.deepEqual(input, ['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent']);
  assert.equal(f.calls.some(([method]) => method === 'Runtime.evaluate'), false);
});

test('a press on a native dropdown sends its options to the viewer instead of opening a list the hidden browser never draws', async () => {
  const f = fakes({nodeAt: at(select)});
  await attachLive(f.channel, f.cdp);
  await f.message({t: 'mouse', type: 'mousePressed', x: 50, y: 30, button: 'left', clickCount: 1, buttons: 1});
  await f.message({t: 'mouse', type: 'mouseReleased', x: 50, y: 30, button: 'left', clickCount: 1, buttons: 0});
  const shown = f.sent.find(message => message.kind === 'select');
  assert.deepEqual(shown.options.map(option => option.value), ['alpha', 'gamma']);
  assert.equal(shown.label, 'Country');
  assert.equal(f.calls.some(([method]) => method === 'Input.dispatchMouseEvent'), false, 'neither the press nor its release reaches the page');
  await f.message({t: 'choose', id: shown.id, value: 'gamma'});
  const set = f.calls.filter(([method]) => method === 'Runtime.callFunctionOn').at(-1)[1];
  assert.deepEqual(set.arguments, [{value: 'gamma'}]);
  assert.match(set.functionDeclaration, /dispatchEvent\(new Event\('change'/);
  const before = f.calls.length;
  await f.message({t: 'choose', id: shown.id, value: 'gamma'});
  assert.equal(f.calls.length, before, 'a pick is used once');
});

test('a press anywhere else is the person\'s press on the page', async () => {
  const f = fakes({nodeAt: at(select)});
  await attachLive(f.channel, f.cdp);
  await f.message({t: 'mouse', type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1, buttons: 1});
  assert.equal(f.sent.some(message => message.kind === 'select'), false);
  assert.ok(f.calls.some(([method]) => method === 'Input.dispatchMouseEvent'));
});

test('a file chooser asks the viewer; only a path the app resolves is set, never one the viewer sends', async () => {
  const f = fakes();
  const resolveFile = choice => (choice === 'cv-2' ? '/app/data/cv/Fictional-CV-2.pdf' : null);
  await attachLive(f.channel, f.cdp, {resolveFile});
  await f.emit('Page.fileChooserOpened', {backendNodeId: 41, mode: 'selectSingle'});
  const asked = f.sent.find(message => message.kind === 'file');
  assert.equal(asked.multiple, false);
  await f.message({t: 'file', id: asked.id, choice: '/etc/passwd'});
  assert.equal(f.calls.some(([method]) => method === 'DOM.setFileInputFiles'), false);
  await f.emit('Page.fileChooserOpened', {backendNodeId: 41, mode: 'selectSingle'});
  const again = f.sent.filter(message => message.kind === 'file').at(-1);
  await f.message({t: 'file', id: again.id, choice: 'cv-2'});
  assert.deepEqual(f.calls.filter(([method]) => method === 'DOM.setFileInputFiles').map(([, params]) => params), [{files: ['/app/data/cv/Fictional-CV-2.pdf'], backendNodeId: 41}]);
});

test('closing the channel stops the stream and lets the page go', async () => {
  const f = fakes();
  await attachLive(f.channel, f.cdp);
  f.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(([method]) => method === 'Page.stopScreencast'));
  assert.ok(f.calls.some(([method]) => method === 'detach'));
});

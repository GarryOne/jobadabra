// The live view's core (hosted/ready-fill/live.mjs attachLive): frames out and the person's input in over a plain message channel (any client:
// the Mac app's screen now, a phone later), with the two bridges a hidden browser needs (B0, 28 Oct 2026): a native dropdown's list drawn by the
// viewer, and a file the app resolves. Nothing here presses anything on its own. Fakes only: no browser, no page, no file outside the test's folder.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attachLive, handoffOf, pageFacts, pressText} from '../../hosted/ready-fill/live.mjs';

function fakes({nodeAt = () => null, evaluate = () => ({}), cookies = []} = {}) {
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
      if (method === 'Page.getLayoutMetrics') return {cssVisualViewport: {clientWidth: 1280, clientHeight: 720}};
      if (method === 'Runtime.evaluate') return evaluate(params.expression);
      if (method === 'Network.getCookies') return {cookies};
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
  assert.deepEqual([f.sent[0].kind, f.sent[0].w, f.sent[0].h], ['first', 1280, 720], 'the viewport size goes with the picture: a press maps back to the page');
  await f.emit('Page.screencastFrame', {data: 'jpeg-1', sessionId: 3, metadata: {deviceWidth: 1024, deviceHeight: 600}});
  assert.deepEqual([f.sent.at(-1).kind, f.sent.at(-1).data, f.sent.at(-1).w, f.sent.at(-1).h], ['frame', 'jpeg-1', 1024, 600]);
  assert.ok(f.calls.some(([method, params]) => method === 'Page.screencastFrameAck' && params.sessionId === 3));
  assert.ok(f.calls.some(([method, params]) => method === 'Page.setInterceptFileChooserDialog' && params.enabled === true));
});

test('the person\'s mouse and keys reach the page; anything else never does', async () => {
  const f = fakes();
  await attachLive(f.channel, f.cdp);
  const before = f.calls.length;
  await f.message({t: 'mouse', type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1, buttons: 1});
  await f.message({t: 'key', key: 'a', text: 'a'});
  await f.message({t: 'eval', code: 'location="https://x.test"'});
  await f.message({t: 'press', text: 'Submit'});
  const after = f.calls.slice(before);
  assert.deepEqual(after.filter(([method]) => method.startsWith('Input.')).map(([method]) => method), ['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent']);
  assert.equal(after.some(([method]) => method === 'Runtime.evaluate'), false, 'no message runs code in the page, and none presses a button by its words');
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

// The page's facts (owner's live view design, 28 Oct 2026): the viewer frames the required fields still empty and counts the fields; the app's Submit stays off while one is left.
const facts = (left = 1) => ({fields: 12, filled: 12 - left, left: Array.from({length: left}, (_, i) => ({label: `Field ${i}`, x: 0.1, y: 0.2 * i, w: 0.8, h: 0.05})), active: ''});
test('the page\'s facts go out on attach, then after frames only when they change, read at most every half second', async () => {
  let now = facts(2), reads = 0;
  const f = fakes({evaluate: () => { reads += 1; return {result: {value: now}}; }});
  await attachLive(f.channel, f.cdp);
  assert.deepEqual(f.sent.filter(message => message.kind === 'needs').map(message => message.left.length), [2]);
  for (let i = 0; i < 5; i += 1) await f.emit('Page.screencastFrame', {data: `jpeg-${i}`, sessionId: i});
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(reads, 2, 'five frames, one read');
  assert.equal(f.sent.filter(message => message.kind === 'needs').length, 1, 'the same facts are not sent again');
  now = facts(0);
  await f.emit('Page.screencastFrame', {data: 'jpeg-9', sessionId: 9});
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.deepEqual(f.sent.filter(message => message.kind === 'needs').map(message => message.left.length), [2, 0]);
  f.close();
});

test('a page that cannot be read sends no facts, and the facts reader answers null for it', async () => {
  const f = fakes();
  await attachLive(f.channel, f.cdp);
  assert.equal(f.sent.some(message => message.kind === 'needs'), false);
  assert.equal(await pageFacts(f.cdp), null);
});

test('the app\'s Submit is one real press at the centre of the page\'s own button; a missing or covered button is never pressed', async () => {
  const pressed = fakes({evaluate: () => ({result: {value: {ok: true, x: 120, y: 340}}})});
  assert.deepEqual(await pressText(pressed.cdp, 'Envoyer'), {ok: true});
  const mouse = pressed.calls.filter(([method]) => method === 'Input.dispatchMouseEvent').map(([, params]) => [params.type, params.x, params.y]);
  assert.deepEqual(mouse, [['mouseMoved', 120, 340], ['mousePressed', 120, 340], ['mouseReleased', 120, 340]]);
  assert.match(pressed.calls.find(([method]) => method === 'Runtime.evaluate')[1].expression, /"Envoyer"/);
  for (const why of ['not_found', 'covered']) {
    const f = fakes({evaluate: () => ({result: {value: {ok: false, why}}})});
    assert.deepEqual(await pressText(f.cdp, 'Envoyer'), {ok: false, why});
    assert.equal(f.calls.some(([method]) => method === 'Input.dispatchMouseEvent'), false);
  }
});

test('Open in my browser from a hidden tab: the shape ready-handoff keeps, with only the cookies of the page\'s own address', async () => {
  const page = {url: 'https://jobs.example.test/apply/1', origin: 'https://jobs.example.test', local: [{name: 'draft', value: '1'}], session: {step: '2'},
    fields: [{id: 'first', name: 'first', type: 'text', value: 'Ada'}], files: [{slot: 'cv', name: 'Fictional-CV.pdf', size: 10}]};
  const cookie = {name: 'sid', value: 'fictional', domain: 'jobs.example.test', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: -1};
  const f = fakes({evaluate: () => ({result: {value: page}}), cookies: [cookie]});
  const made = await handoffOf(f.cdp);
  assert.deepEqual(made, {url: page.url, storage: {cookies: [cookie], origins: [{origin: page.origin, localStorage: page.local}]}, sessionStorage: {step: '2'}, snapshot: {fields: page.fields, files: page.files}});
  assert.deepEqual(f.calls.find(([method]) => method === 'Network.getCookies')[1], {urls: [page.url]});
  assert.equal(await handoffOf(fakes().cdp), null, 'a page that cannot be read hands nothing off');
});

// B follow-up 3 (28 Oct 2026): fields inside a frame were not counted, so an iframe form read "0 fields" and Submit's floor saw nothing.
function framed({frames, failing = []}) {
  const main = {address: 'x.test/apply', fields: 1, filled: 1, left: [], active: ''};
  const sent = [];
  const cdp = {send: async (method, params = {}) => {
    sent.push(method);
    if (method === 'Page.getFrameTree') return {frameTree: {frame: {id: 'top'}, childFrames: frames.map(id => ({frame: {id}}))}};
    if (method === 'Runtime.evaluate' && params.contextId) return {result: {value: failing.includes(params.contextId) ? undefined : {fields: 3, filled: 1, left: [{label: 'Email', x: 0.1, y: 0.5, w: 0.5, h: 0.1}], active: 'Email'}}};
    if (method === 'Runtime.evaluate') return {result: {value: /innerWidth \|\| 1, innerHeight/.test(params.expression) ? [1000, 800] : main}};
    if (method === 'DOM.getFrameOwner') return {backendNodeId: 5};
    if (method === 'DOM.getBoxModel') return {model: {content: [100, 200, 500, 200, 500, 600, 100, 600]}};
    if (method === 'Page.createIsolatedWorld') return {executionContextId: params.frameId};
    return {};
  }};
  return {cdp, sent};
}

test('a frame\'s fields are added and its empty required boxes are mapped onto the main picture', async () => {
  const {cdp} = framed({frames: ['f1']});
  const facts = await pageFacts(cdp);
  assert.equal(facts.fields, 4);
  assert.equal(facts.filled, 2);
  assert.equal(facts.active, 'Email', 'the frame\'s field being typed in shows when the page has none');
  // frame at (100,200) 400x400 inside a 1000x800 page: x = (100 + .1*400)/1000, y = (200 + .5*400)/800, w = .5*400/1000, h = .1*400/800
  assert.deepEqual(facts.left, [{label: 'Email', x: 0.14, y: 0.5, w: 0.2, h: 0.05}]);
});

test('a frame that cannot be read is skipped, and a page without frames makes no frame call', async () => {
  const skipped = await pageFacts(framed({frames: ['f1', 'f2'], failing: ['f1']}).cdp);
  assert.equal(skipped.fields, 4, 'only the readable frame is added');
  const none = framed({frames: []});
  assert.equal((await pageFacts(none.cdp)).fields, 1);
  assert.equal(none.sent.some(method => /^(DOM|Page\.createIsolatedWorld)/.test(method)), false);
});

// Gitar on #2354 (28 Oct 2026): a world per frame per read piled up in the hidden browser, and an iframe on another site (its own process) was never listed under the page.
test('a frame\'s world is made once and kept across reads; a stale one is made again', async () => {
  const {cdp, sent} = framed({frames: ['f1']});
  const frames = {worlds: new Map()};
  await pageFacts(cdp, frames);
  await pageFacts(cdp, frames);
  assert.equal(sent.filter(method => method === 'Page.createIsolatedWorld').length, 1, 'two reads, one world');
  const stale = framed({frames: ['f1']});
  const real = stale.cdp.send;
  let first = true;
  stale.cdp.send = async (method, params) => { if (method === 'Runtime.evaluate' && params.contextId && first) { first = false; throw new Error('Cannot find context'); } return real(method, params); };
  const worlds = new Map([['f1', 'old-context']]);
  assert.equal((await pageFacts(stale.cdp, {worlds})).fields, 4, 'the stale world is replaced and the read succeeds');
  assert.equal(worlds.get('f1'), 'f1', 'the new world is the one kept');
  const gone = new Map([['f1', 'x'], ['f9', 'y']]);
  await pageFacts(framed({frames: ['f1']}).cdp, {worlds: gone});
  assert.deepEqual([...gone.keys()], ['f1'], 'a frame that left the page loses its world');
});

test('an iframe in its own process is read over its own session and placed by the parent\'s box for it', async () => {
  const {cdp, sent} = framed({frames: []});
  const own = {send: async (method, params) => { assert.equal(method, 'Runtime.evaluate'); assert.equal(params.contextId, undefined, 'its own main world, no isolated world'); return {result: {value: {fields: 2, filled: 0, left: [{label: 'Phone', x: 0, y: 0, w: 1, h: 0.25}], active: ''}}}; }};
  const facts = await pageFacts(cdp, {targets: async () => [{id: 'oopif', cdp: own}]});
  assert.equal(facts.fields, 3);
  assert.deepEqual(facts.left, [{label: 'Phone', x: 0.1, y: 0.25, w: 0.4, h: 0.125}]);
  assert.equal(sent.includes('Page.createIsolatedWorld'), false);
  const broken = await pageFacts(cdp, {targets: async () => [{id: 'oopif', cdp: {send: async () => { throw new Error('gone'); }}}]});
  assert.equal(broken.fields, 1, 'an unreadable iframe is skipped');
});

// The morning's two ways in to a filled tab (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md; measured by the server proof, 17 Oct 2026: open p50 155 ms, input p50 79 ms, hand-off restore 5 of 5 in ~10 ms):
//  - the LIVE VIEW: a CDP screencast of the tab over a WebSocket, the person's mouse and keys coming back as CDP input. He solves a human check and presses Submit in it; nothing here presses anything on its own.
//  - the HAND-OFF: what his own browser needs to open the same page filled: the address, the browser's storage (cookies, localStorage, sessionStorage) and a snapshot of the page's fields and file slots by identity.
// Pure parts are exported for the tests; the page-facing ones take a Playwright page. Guard: desktop/test/ready-fill.test.js.

// Pure: the input message from the viewer -> a CDP call [method, params], or null for something unknown. Only mouse and key input pass; nothing else reaches the browser.
export function inputToCdp(message) {
  if (message?.t === 'mouse' && ['mouseMoved', 'mousePressed', 'mouseReleased', 'mouseWheel'].includes(message.type)) {
    return ['Input.dispatchMouseEvent', {type: message.type, x: Number(message.x) || 0, y: Number(message.y) || 0, button: message.button || 'none', clickCount: message.clickCount || 0, buttons: message.buttons || 0,
      ...(message.type === 'mouseWheel' ? {deltaX: Number(message.deltaX) || 0, deltaY: Number(message.deltaY) || 0} : {})}];
  }
  if (message?.t === 'key' && typeof message.key === 'string' && message.key.length <= 32) return ['Input.dispatchKeyEvent', {type: message.up ? 'keyUp' : 'keyDown', key: message.key, text: message.up ? undefined : message.text, windowsVirtualKeyCode: message.code || undefined}];
  return null;
}

// The page side of the native-dropdown bridge (B0, 28 Oct 2026: a hidden browser never draws a <select>'s list). Run on the node under the press.
const SELECT_OF = "function () { const s = this.closest ? this.closest('select') : null; return s && !s.disabled && !s.multiple ? s : null; }";
// The label's own words: a <label> that wraps its <select> would otherwise carry every option's text (measured 28 Oct 2026).
const OPTIONS_OF = "function () { const l = this.labels?.[0]?.cloneNode(true); l?.querySelectorAll('select,option,input,textarea,button').forEach(e => e.remove()); return {label: (l?.textContent || this.getAttribute('aria-label') || this.name || '').replace(/\\s+/g, ' ').trim().slice(0, 120), value: this.value, options: [...this.options].map(o => ({value: o.value, label: (o.label || o.text).trim().slice(0, 120), disabled: o.disabled}))}; }";
// The person's pick, set the way a page hears it: the native value setter (a framework's own setter would swallow it), then input and change.
const CHOOSE = "function (value) { if (![...this.options].some(o => o.value === value && !o.disabled)) return false; this.focus(); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(this, value); this.dispatchEvent(new Event('input', {bubbles: true})); this.dispatchEvent(new Event('change', {bubbles: true})); return true; }";

/** A WebSocket (the `ws` package) as a live-view channel: {send, onMessage, onClose} carrying plain JSON messages. */
export function wsChannel(ws) {
  return {send: message => ws.readyState === 1 && ws.send(JSON.stringify(message)), onMessage: fn => ws.on('message', raw => { let message; try { message = JSON.parse(raw); } catch { return; } fn(message); }),
    onClose: fn => ws.on('close', fn)};
}

/**
 * The live view of one held tab over any channel ({send, onMessage, onClose}: the Mac app's screen now, a phone later) and any CDP session
 * ({send, on, detach}: Playwright's, or the app's own to its hidden browser). Out: {kind: 'first'|'frame', data} pictures, {kind: 'select'} a native
 * dropdown's list to draw, {kind: 'file'} a file chooser to answer. In: mouse and key ({t: 'mouse'|'key'}), {t: 'choose', id, value}, {t: 'file', id, choice}.
 * resolveFile(choice) -> a path the APP allows (the person's CVs, a file they picked in the app's own dialog) or null; a path from the channel is never used.
 * Invariant: every page change here follows one message from the person; nothing presses, picks or uploads on its own.
 */
export async function attachLive(channel, cdp, {resolveFile = () => null} = {}) {
  let seq = 0, nextId = 0, swallowRelease = false;
  const selects = new Map(), choosers = new Map();
  const send = (kind, extra) => channel.send({kind, seq: ++seq, at: Date.now(), ...extra});
  const fail = error => send('error', {data: String(error?.message || error).slice(0, 200)});
  cdp.on('Page.screencastFrame', async frame => { send('frame', {data: frame.data}); await cdp.send('Page.screencastFrameAck', {sessionId: frame.sessionId}).catch(() => {}); });
  cdp.on('Page.fileChooserOpened', ({backendNodeId, mode}) => { const id = ++nextId; choosers.clear(); choosers.set(id, backendNodeId); send('file', {id, multiple: mode === 'selectMultiple'}); });
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Page.setInterceptFileChooserDialog', {enabled: true}).catch(() => {});   // a hidden browser opens no dialog: the viewer is asked instead
  send('first', {data: (await cdp.send('Page.captureScreenshot', {format: 'jpeg', quality: 60})).data});
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 60, everyNthFrame: 1});
  // -> the objectId of the native <select> under (x, y), or null
  const selectAt = async (x, y) => {
    const {backendNodeId} = await cdp.send('DOM.getNodeForLocation', {x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false}).catch(() => ({}));
    if (!backendNodeId) return null;
    const {object} = await cdp.send('DOM.resolveNode', {backendNodeId}).catch(() => ({}));
    if (!object?.objectId) return null;
    const {result} = await cdp.send('Runtime.callFunctionOn', {objectId: object.objectId, functionDeclaration: SELECT_OF}).catch(() => ({}));
    return result?.objectId || null;
  };
  const handle = async message => {
    if (message?.t === 'ping') return channel.send({kind: 'pong', id: message.id});
    if (message?.t === 'choose') {
      const objectId = selects.get(message.id); selects.delete(message.id);
      if (objectId && typeof message.value === 'string') await cdp.send('Runtime.callFunctionOn', {objectId, functionDeclaration: CHOOSE, arguments: [{value: message.value}]});
      return;
    }
    if (message?.t === 'file') {
      const backendNodeId = choosers.get(message.id); choosers.delete(message.id);
      const file = backendNodeId && message.choice ? await resolveFile(message.choice) : null;
      if (file) await cdp.send('DOM.setFileInputFiles', {files: [file], backendNodeId});
      return;
    }
    if (message?.t === 'mouse' && message.type === 'mouseReleased' && swallowRelease) { swallowRelease = false; return; }
    if (message?.t === 'mouse' && message.type === 'mousePressed' && message.button === 'left') {
      const objectId = await selectAt(message.x, message.y);
      if (objectId) {
        const {result} = await cdp.send('Runtime.callFunctionOn', {objectId, functionDeclaration: OPTIONS_OF, returnByValue: true});
        const id = ++nextId; selects.clear(); selects.set(id, objectId); swallowRelease = true;
        return send('select', {id, ...result?.value});
      }
    }
    const call = inputToCdp(message);
    if (call) await cdp.send(...call);
  };
  channel.onMessage(message => handle(message).catch(fail));
  channel.onClose(() => { cdp.send('Page.stopScreencast').catch(() => {}); cdp.detach().catch(() => {}); });
}

// ws: a WebSocket (the `ws` package); page: the held tab (Playwright). Ready to send's server (main.mjs) calls this.
export async function attach(ws, page) {
  return attachLive(wsChannel(ws), await page.context().newCDPSession(page));
}

// The hand-off for a held tab. The snapshot has field identity and value, never read back anywhere but the owner's own browser.
export async function handoff(page) {
  const snapshot = await page.evaluate(() => ({
    fields: [...document.querySelectorAll('input:not([type=file]):not([type=password]),select,textarea')].map(e => ({id: e.id, name: e.name, type: e.type, value: e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value})),
    files: [...document.querySelectorAll('input[type=file]')].map(e => ({slot: e.id || e.name, name: e.files[0]?.name || '', size: e.files[0]?.size || 0}))}));
  const session = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))).catch(() => '{}');
  return {url: page.url(), storage: await page.context().storageState(), sessionStorage: JSON.parse(session), snapshot};
}

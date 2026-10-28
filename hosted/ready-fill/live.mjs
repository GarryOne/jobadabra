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

const FACTS_MS = 500;
// What the viewer draws over the picture, read from the page's structure only (never judged here): how many fields, how many hold a value, the required
// ones still empty (each a box as a share of the viewport, so any picture size maps it) and the field being typed in. A radio group is one field.
// Why (28 Oct 2026, owner's live view design): the app's Submit stays off while a required field is empty; this is that floor, ANDed with the form judge's ready.
// TODO(AI): fields inside a frame are not counted; the form judge's ready still gates Submit there (28 Oct 2026, PR B).
const PAGE_FACTS = `(() => {
  const shown = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const all = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),select,textarea')].filter(e => !e.disabled && shown(e));
  const units = [], radios = new Map();
  for (const e of all) { if (e.type === 'radio' && e.name) { if (!radios.has(e.name)) { radios.set(e.name, []); units.push(radios.get(e.name)); } radios.get(e.name).push(e); } else units.push([e]); }
  const required = u => u.some(e => e.required || e.getAttribute('aria-required') === 'true');
  const filled = u => u.some(e => (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.type === 'file' ? e.files.length > 0 : String(e.value).trim() !== ''));
  const labelOf = e => { const l = e.labels?.[0]?.cloneNode(true); l?.querySelectorAll('select,option,input,textarea,button').forEach(x => x.remove()); return (l?.textContent || e.getAttribute('aria-label') || e.placeholder || e.name || '').replace(/\\s+/g, ' ').trim().slice(0, 80); };
  const W = innerWidth || 1, H = innerHeight || 1, r4 = n => Math.round(n * 1e4) / 1e4;
  const box = u => { const rs = u.map(e => e.getBoundingClientRect()), x = Math.min(...rs.map(r => r.left)), y = Math.min(...rs.map(r => r.top));
    return {x: r4(x / W), y: r4(y / H), w: r4((Math.max(...rs.map(r => r.right)) - x) / W), h: r4((Math.max(...rs.map(r => r.bottom)) - y) / H)}; };
  const a = document.activeElement;
  const unitLabel = u => (u.length > 1 && u[0].closest('fieldset')?.querySelector('legend')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)) || labelOf(u[0]);   // a radio group: its question
  return {fields: units.length, filled: units.filter(filled).length, left: units.filter(u => required(u) && !filled(u)).map(u => ({label: unitLabel(u), ...box(u)})), active: a && all.includes(a) ? labelOf(a) : ''};
})()`;
/** The page's facts for the viewer ({fields, filled, left: [{label, x, y, w, h}], active}), or null when the page cannot be read. */
export async function pageFacts(cdp) {
  const {result} = await cdp.send('Runtime.evaluate', {expression: PAGE_FACTS, returnByValue: true}).catch(() => ({}));
  return result?.value && typeof result.value === 'object' ? result.value : null;
}

// The one button whose words are `text` (the form judge's submit_control, copied from the page's own Buttons list), scrolled into view: its centre, or why not.
const BUTTON_AT = text => `(() => {
  const plain = t => String(t ?? '').replace(/\\s+/g, ' ').trim().toLowerCase().slice(0, 80), want = plain(${JSON.stringify(String(text || ''))});
  const found = want && [...document.querySelectorAll('button,input[type=submit],input[type=button],a,[role=button]')]
    .find(e => e.getClientRects().length > 0 && !e.disabled && plain(e.innerText || e.value || e.getAttribute('aria-label')) === want);
  if (!found) return {ok: false, why: 'not_found'};
  found.scrollIntoView({block: 'center', behavior: 'instant'});
  const r = found.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
  return top && (top === found || found.contains(top)) ? {ok: true, x, y} : {ok: false, why: 'covered'};
})()`;
/**
 * The person's press on the page's own sending button, from the app's Submit: a real mouse press at its centre, so the page and the extension's
 * submit watch see what a hand on the page would make. Called by the app (never from a channel message), with the text the app holds.
 * -> {ok: true} or {ok: false, why: 'not_found'|'covered'}.
 */
export async function pressText(cdp, text) {
  const {result} = await cdp.send('Runtime.evaluate', {expression: BUTTON_AT(text), returnByValue: true});
  const at = result?.value;
  if (!at?.ok) return {ok: false, why: at?.why || 'not_found'};
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {type, x: at.x, y: at.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1});
  }
  return {ok: true};
}

// The fields and file slots by identity, the same for both hand-offs (Playwright's below and the app's own CDP one). Never a password.
const SNAPSHOT = `(() => {
  const safe = (read, none) => { try { return read(); } catch { return none; } };   // an opaque origin throws on its storage
  return {fields: [...document.querySelectorAll('input:not([type=file]):not([type=password]),select,textarea')].map(e => ({id: e.id, name: e.name, type: e.type, value: e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value})),
    files: [...document.querySelectorAll('input[type=file]')].map(e => ({slot: e.id || e.name, name: e.files[0]?.name || '', size: e.files[0]?.size || 0})),
    url: location.href, origin: location.origin,
    local: safe(() => Object.entries(localStorage).map(([name, value]) => ({name, value})), []), session: safe(() => Object.fromEntries(Object.entries(sessionStorage)), {})};
})()`;
/** "Open in my browser" from a hidden-browser tab: the shape ready-handoff.js keeps (address, the page's cookies and its origin's storage, the snapshot). */
export async function handoffOf(cdp) {
  const {result} = await cdp.send('Runtime.evaluate', {expression: SNAPSHOT, returnByValue: true});
  const page = result?.value;
  if (!page?.url) return null;
  const {cookies = []} = await cdp.send('Network.getCookies', {urls: [page.url]}).catch(() => ({}));
  return {url: page.url, storage: {cookies, origins: [{origin: page.origin, localStorage: page.local}]}, sessionStorage: page.session, snapshot: {fields: page.fields, files: page.files}};
}

/** A WebSocket (the `ws` package) as a live-view channel: {send, onMessage, onClose} carrying plain JSON messages. */
export function wsChannel(ws) {
  return {send: message => ws.readyState === 1 && ws.send(JSON.stringify(message)), onMessage: fn => ws.on('message', raw => { let message; try { message = JSON.parse(raw); } catch { return; } fn(message); }),
    onClose: fn => ws.on('close', fn)};
}

/**
 * The live view of one held tab over any channel ({send, onMessage, onClose}: the Mac app's screen now, a phone later) and any CDP session
 * ({send, on, detach}: Playwright's, or the app's own to its hidden browser). Out: {kind: 'first'|'frame', data} pictures, {kind: 'needs'} the page's
 * facts (pageFacts), {kind: 'select'} a native dropdown's list to draw, {kind: 'file'} a file chooser to answer. In: mouse and key ({t: 'mouse'|'key'}), {t: 'choose', id, value}, {t: 'file', id, choice}.
 * resolveFile(choice) -> a path the APP allows (the person's CVs, a file they picked in the app's own dialog) or null; a path from the channel is never used.
 * Invariant: every page change here follows one message from the person; nothing presses, picks or uploads on its own.
 */
export async function attachLive(channel, cdp, {resolveFile = () => null} = {}) {
  let seq = 0, nextId = 0, swallowRelease = false, lastFacts = '', factsTimer = null, closed = false;
  const selects = new Map(), choosers = new Map();
  const send = (kind, extra) => channel.send({kind, seq: ++seq, at: Date.now(), ...extra});
  const fail = error => send('error', {data: String(error?.message || error).slice(0, 200)});
  // The page's facts follow its pictures: read at most every FACTS_MS after a frame (the last change is always read), sent only when they differ.
  const readFacts = async () => {
    factsTimer = null;
    const facts = closed ? null : await pageFacts(cdp);
    if (facts && JSON.stringify(facts) !== lastFacts) { lastFacts = JSON.stringify(facts); send('needs', facts); }
  };
  const factsSoon = () => { if (!factsTimer && !closed) factsTimer = setTimeout(() => readFacts().catch(() => {}), FACTS_MS); };
  cdp.on('Page.screencastFrame', async frame => { send('frame', {data: frame.data}); factsSoon(); await cdp.send('Page.screencastFrameAck', {sessionId: frame.sessionId}).catch(() => {}); });
  cdp.on('Page.fileChooserOpened', ({backendNodeId, mode}) => { const id = ++nextId; choosers.clear(); choosers.set(id, backendNodeId); send('file', {id, multiple: mode === 'selectMultiple'}); });
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Page.setInterceptFileChooserDialog', {enabled: true}).catch(() => {});   // a hidden browser opens no dialog: the viewer is asked instead
  send('first', {data: (await cdp.send('Page.captureScreenshot', {format: 'jpeg', quality: 60})).data});
  await readFacts();
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
  channel.onClose(() => { closed = true; clearTimeout(factsTimer); cdp.send('Page.stopScreencast').catch(() => {}); cdp.detach().catch(() => {}); });
}

// ws: a WebSocket (the `ws` package); page: the held tab (Playwright). Ready to send's server (main.mjs) calls this.
export async function attach(ws, page) {
  return attachLive(wsChannel(ws), await page.context().newCDPSession(page));
}

// The hand-off for a held tab. The snapshot has field identity and value, never read back anywhere but the owner's own browser.
export async function handoff(page) {
  const {fields, files, session} = await page.evaluate(SNAPSHOT);
  return {url: page.url(), storage: await page.context().storageState(), sessionStorage: session, snapshot: {fields, files}};
}

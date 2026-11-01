// Typing the mailed code (extension/account-fill.js fillCodeBox): into the box the account AI named, else the page's one empty code box, or across a row of
// one-character boxes; never a password box, never with no code; what it fills is marked, so the account button may be pressed next.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadJsdom} from './helpers/page.js';

const JSDOM = await loadJsdom();
async function inPage(html, run) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {url: 'https://auth.example/u/challenge', pretendToBeVisual: true});
  const keep = {window: globalThis.window, document: globalThis.document, HTMLInputElement: globalThis.HTMLInputElement, Event: globalThis.Event, CSS: globalThis.CSS};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, CSS: {escape: text => String(text)}});
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {get() { return this.textContent; }});
  dom.window.HTMLElement.prototype.getClientRects = () => [{width: 100, height: 20}];
  try { return await run(await import('../../extension/account-fill.js'), dom.window); } finally { Object.assign(globalThis, keep); }
}

test('the named box gets the code and is marked; no code or only a password box: nothing', {skip: !JSDOM}, async () => {
  await inPage('<label for="c">Verification code *</label><input id="c" type="text"><input id="o" type="text" placeholder="Promo">', ({fillCodeBox}, win) => {
    assert.equal(fillCodeBox('Verification code *', '482913'), 1);
    assert.equal(win.document.getElementById('c').value, '482913');
    assert.ok(win.document.getElementById('c').hasAttribute('data-jobpilotto-filled'));
    assert.equal(win.document.getElementById('o').value, '');
  });
  await inPage('<input id="p" type="password">', ({fillCodeBox}) => { assert.equal(fillCodeBox('Code', '482913'), 0); });
  await inPage('<input id="c" type="text">', ({fillCodeBox}, win) => { assert.equal(fillCodeBox('Code', ''), 0); assert.equal(win.document.getElementById('c').value, ''); });
});

test('one empty box with no matching label, or a row of one-character boxes, also takes the code; two unnamed boxes do not', {skip: !JSDOM}, async () => {
  await inPage('<input id="c" type="tel">', ({fillCodeBox}, win) => { assert.equal(fillCodeBox('Enter the code', '7781'), 1); assert.equal(win.document.getElementById('c').value, '7781'); });
  await inPage([1, 2, 3, 4, 5, 6].map(n => `<input id="d${n}" type="text" maxlength="1">`).join(''), ({fillCodeBox}, win) => {
    assert.equal(fillCodeBox('', '482913'), 1);
    assert.equal([1, 2, 3, 4, 5, 6].map(n => win.document.getElementById(`d${n}`).value).join(''), '482913');
  });
  await inPage('<input id="a" type="text"><input id="b" type="text">', ({fillCodeBox}) => { assert.equal(fillCodeBox('Code', '1234'), 0); });
});

// Accepting an account's consent (extension/account-fill.js pressConsent): a checkbox only when the page says it is needed (required, or the button is disabled without
// it); an optional box (newsletter, talent pool) is never ticked in the person's name; a privacy link is pressed as before (10 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadJsdom} from './helpers/page.js';

const JSDOM = await loadJsdom();
async function inPage(html, run) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {url: 'https://jobs.example/signup', pretendToBeVisual: true});
  const keep = {window: globalThis.window, document: globalThis.document};
  Object.assign(globalThis, {window: dom.window, document: dom.window.document});
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {get() { return this.textContent; }});
  dom.window.HTMLElement.prototype.getClientRects = () => [{width: 100, height: 20}];
  try { return await run(await import('../../extension/account-fill.js'), dom.window); } finally { Object.assign(globalThis, keep); }
}
const form = (box, disabled = false) => `<form><label><input type="checkbox" id="b" ${box}> ${'I accept the terms of use'}</label><button type="submit" ${disabled ? 'disabled' : ''}>Create account</button></form>`;

test('a required terms box is ticked; so is one the button waits for; an optional one is not', {skip: !JSDOM}, async () => {
  await inPage(form('required'), ({pressConsent}, win) => { assert.equal(pressConsent('I accept the terms of use'), 'pressed'); assert.equal(win.document.getElementById('b').checked, true); });
  await inPage(form('', true), ({pressConsent}, win) => { assert.equal(pressConsent('I accept the terms of use'), 'pressed'); assert.equal(win.document.getElementById('b').checked, true); });
  await inPage(form(''), ({pressConsent}, win) => { assert.equal(pressConsent('I accept the terms of use'), 'optional-box'); assert.equal(win.document.getElementById('b').checked, false); });
});

test('a ticked box stays as it is; a privacy link the AI named is pressed', {skip: !JSDOM}, async () => {
  await inPage(form('required checked'), ({pressConsent}) => { assert.equal(pressConsent('I accept the terms of use'), 'already'); });
  await inPage('<a id="l" href="#">Read and accept the privacy statement</a>', ({pressConsent}, win) => {
    let clicked = false; win.document.getElementById('l').addEventListener('click', event => { clicked = true; event.preventDefault(); });
    assert.equal(pressConsent('Read and accept the privacy statement'), 'pressed');
    assert.ok(clicked);
  });
});

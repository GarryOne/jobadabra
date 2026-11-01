// Popups found by structure (extension/popup-page.js): a newsletter offer in any language is listed with its buttons and the named one pressed;
// a form in a dialog, a password box and the extension's own panel are never offered.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadJsdom } from './helpers/page.js';

const JSDOM = await loadJsdom();

async function inPage(html, run) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://karriere.example/jobs', pretendToBeVisual: true });
  const keep = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, location: globalThis.location };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), location: dom.window.location });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, bottom: 400, right: 600 });
  try { return await run(await import('../../extension/popup-page.js'), dom.window); } finally { Object.assign(globalThis, keep); }
}

test('a newsletter dialog in German: its text and buttons are listed, the named one is pressed', { skip: !JSDOM }, async () => {
  const html = '<div role="dialog"><p>Bleiben Sie auf dem Laufenden mit unserem Newsletter!</p><button id="y">Jetzt anmelden</button><button id="n">Nein, danke</button></div>';
  await inPage(html, ({ findPopup }, win) => {
    let pressed = '';
    win.document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed = b.id; }));
    const seen = findPopup({ list: true });
    assert.deepEqual(seen.buttons, ['Jetzt anmelden', 'Nein, danke']);
    assert.match(seen.text, /Newsletter/);
    assert.equal(findPopup({ press: 'Nein, danke' }), 'Nein, danke');
    assert.equal(pressed, 'n');
    assert.equal(findPopup({ press: 'Not on it' }), '');
  });
});

test('a layer fixed over the page counts, with no role at all', { skip: !JSDOM }, async () => {
  await inPage('<div style="position:fixed;z-index:999"><span>Chat with us</span><button>×</button></div>', ({ findPopup }) => {
    assert.deepEqual(findPopup({ list: true }).buttons, ['×']);
  });
});

test('never offered: a form in a dialog, a password box, the extension\'s own panel', { skip: !JSDOM }, async () => {
  const form = '<div role="dialog"><input type="text"><input type="email"><input type="tel"><button>Next</button></div>';
  const login = '<div role="dialog"><input type="password"><button>Sign in</button></div>';
  const ours = '<div id="jobpilotto-panel" role="dialog"><button>Hide</button></div>';
  for (const html of [form, login, ours]) await inPage(html, ({ findPopup }) => assert.equal(findPopup({ list: true }), null, html));
});

// The same floor as the cookie banner's (visit-consent.test.js, jobs.ch 10 Oct 2026): a link to another address or a new tab never closes a popup.
test('a link that leaves the page is never offered as the way to close a popup', { skip: !JSDOM }, async () => {
  const html = '<div role="dialog"><p>Stay in touch! Read our privacy notice.</p><a id="p" href="/privacy" target="_blank">Privacy notice</a>'
    + '<a id="o" href="https://other.example/x">Partner offer</a><a id="n" href="#">No thanks</a></div>';
  await inPage(html, ({ findPopup }, win) => {
    let clicked = '';
    win.document.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { clicked = a.id; e.preventDefault(); }));
    assert.deepEqual(findPopup({ list: true }).buttons, ['No thanks']);
    assert.equal(findPopup({ press: 'Privacy notice' }), '');
    assert.equal(clicked, '');
    assert.equal(findPopup({ press: 'No thanks' }), 'No thanks');
    assert.equal(clicked, 'n');
  });
});

test('a popup drawn inside an open shadow root is found by structure and its named button pressed (Hornbach, 11 Oct 2026)', { skip: !JSDOM }, async () => {
  await inPage('<main><p>Stelle</p></main><div id="host"></div>', ({ findPopup }, win) => {
    const shadow = win.document.getElementById('host').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div role="dialog"><p>Newsletter?</p><button id="n">Nein, danke</button><button id="y">Anmelden</button></div>';
    let pressed = '';
    shadow.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed = b.id; }));
    assert.deepEqual(findPopup({ list: true }).buttons, ['Nein, danke', 'Anmelden']);
    assert.equal(findPopup({ press: 'Nein, danke' }), 'Nein, danke');
    assert.equal(pressed, 'n');
  });
});

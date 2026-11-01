// The end check's page-side half (desktop/e2e/lib/cookie-layer-left.mjs), on Fidag's cases: an open fixed cookie bar is named, a static wrapper with a cookie-ish class and a map's controls is not (the first live end check named the language switch), nothing open is nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadJsdom } from './helpers/page.js';
import { cookieLayerLeft } from '../../desktop/e2e/lib/cookie-layer-left.mjs';

const JSDOM = await loadJsdom();

function run(html) {
  const dom = new JSDOM(`<body>${html}</body>`, { pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  win.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
  const keep = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  Object.assign(globalThis, { document: win.document, getComputedStyle: win.getComputedStyle.bind(win) });
  try { return cookieLayerLeft(); } finally { Object.assign(globalThis, keep); }
}

test('an open fixed cookie bar is named; a static wrapper or a closed bar is not', { skip: !JSDOM }, () => {
  assert.deepEqual(run('<div id="cookie-notice" style="position:fixed;bottom:0">Nous utilisons des cookies <a href="#">Ok</a></div>'), ['Ok']);
  assert.deepEqual(run('<div class="cookie-notice-hidden"><p>Politiques de cookies</p><button>Fr</button><button>Toggle fullscreen view</button></div>'), []);
  assert.deepEqual(run('<p>Politiques de cookies</p>'), []);
});

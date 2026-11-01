// A cookie bar that is no dialog and speaks of cookies in a plain div (WordPress Cookie Notice shape, Fidag, 11 Oct 2026): found and closed by its own "Ok".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadJsdom } from './helpers/page.js';

const JSDOM = await loadJsdom();

test('a cookie bar whose only button is "Ok" (a # link) is closed', { skip: !JSDOM }, async () => {
  const html = '<div id="cookie-notice" role="banner" aria-label="Cookie Notice"><div class="cookie-notice-container"><span id="cn-notice-text">Nous utilisons des cookies afin de vous fournir une expérience. Pour en savoir plus, lisez notre politique de confidentialité et de cookies.</span>'
    + '<span id="cn-notice-buttons"><a href="#" id="cn-accept-cookie" aria-label="Ok">Ok</a><a href="https://example.test/politique-cookies" id="cn-more-info" target="_blank">Politique de confidentialité</a></span></div><a href="javascript:void(0);" id="cn-close-notice" aria-label="Ok"></a></div>';
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://employeur.example/offres/comptable/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), location: dom.window.location });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 120, height: 30, top: 0, left: 0, bottom: 30, right: 120 });
  const { closeConsent } = await import('../../extension/visit-page.js');
  let pressed = '';
  dom.window.document.getElementById('cn-accept-cookie').addEventListener('click', () => { pressed = 'ok'; });
  assert.equal(closeConsent({ cookiesOnly: true }), 'Ok');
  assert.equal(pressed, 'ok');
});

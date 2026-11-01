// The next step of a multi-step application (extension/next-step.js): the named control is pressed only when it does not submit (owner, 8 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom } from './helpers/page.js';
import { pressInPage } from '../../extension/next-step.js';

const JSDOM = await loadJsdom();
function page(html) {
  const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://jobs.example.ch/apply' });
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };   // jsdom has no layout: visible unless hidden
  const clicks = [];
  dom.window.document.addEventListener('click', (event) => clicks.push(event.target.textContent || event.target.value));
  globalThis.document = dom.window.document;
  return { clicks, close: () => { delete globalThis.document; dom.window.close(); } };
}

test('a plain Next button is pressed; one that submits the form, reads like Submit, is hidden or missing is not', { skip: !JSDOM }, () => {
  const cases = [
    ['<form><button type="button">Continuer</button></form>', 'Continuer', true, undefined],
    ['<form><button>Continuer</button></form>', 'Continuer', false, 'it submits a form'],                 // a button in a form submits by default
    ['<form><input type="submit" value="Weiter"></form>', 'Weiter', false, undefined],
    ['<a href="#step2">Next</a>', 'next', true, undefined],                                             // any case, the page's own wording
    ['<div role="button">Submit application</div>', 'Submit application', false, 'it reads like Submit'],
    ['<button type="button" hidden>Continuer</button>', 'Continuer', false, 'not on the page'],
    ['<button type="button">Retour</button>', 'Continuer', false, 'not on the page'],
  ];
  for (const [html, text, pressed, why] of cases) {
    const { clicks, close } = page(html);
    const result = pressInPage(text);
    assert.equal(result.pressed, pressed, html);
    if (why) assert.equal(result.why, why, html);
    assert.equal(clicks.length, pressed ? 1 : 0, html);
    close();
  }
});

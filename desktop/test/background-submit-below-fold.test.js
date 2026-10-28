// extension/background-submit.js submissionPage: the hidden browser's readiness check must find the form's Submit button even below the fold (measured 28 Oct 2026: button at y=464 in a 413 px
// viewport, elementFromPoint null, safe false, so every filled form was handed to the person as "incomplete or uncertain"). Fake page only: no browser, no network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {submissionPage} from '../../extension/background-submit.js';

function fakePage({top = 464, viewport = 413, coveredBy = null} = {}) {
  let scrolled = 0;
  const flags = {fieldsOnly: false};
  const button = {tagName: 'BUTTON', innerText: 'Submit Application', disabled: false, getClientRects: () => [1], getAttribute: () => null, contains: el => el === button,
    getBoundingClientRect: () => ({left: 58, top: top - scrolled, width: 126, height: 21}), scrollIntoView: () => { scrolled = Math.max(0, top - 100); }};
  const input = {tagName: 'INPUT', type: 'text', id: 'n', name: 'n', required: true, value: 'Ada', checked: false, files: null, disabled: false, getClientRects: () => [1],
    getAttribute: name => (name === 'data-jobpilotto-grounding' ? 'known' : null), checkValidity: () => true};
  const document = {title: 'Apply', body: {innerText: 'Apply'},
    querySelectorAll: selector => (selector.startsWith('input, textarea') ? [input] : selector.startsWith('button, a') ? [button] : []),
    elementFromPoint: (x, y) => (y >= 0 && y < viewport ? (coveredBy || button) : null)};
  return {document, button, flags, scrolled: () => scrolled};
}

async function inspect(page) {
  const saved = {document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, location: globalThis.location};
  Object.assign(globalThis, {document: page.document, getComputedStyle: () => ({visibility: 'visible', display: 'block'}), location: {href: 'https://jobs.example.test/apply'}});
  try { return await submissionPage('inspect', {control: 'Submit Application'}); } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
}

test('a Submit button below the fold is still found: the check scrolls it into view before asking what is on top', async () => {
  const page = fakePage({top: 464, viewport: 413});
  const result = await inspect(page);
  assert.equal(result.safe, true, 'the named button is unique, enabled and on top once it is in view');
  assert.equal(result.requiredComplete, true);
  assert.ok(page.scrolled() > 0, 'it was scrolled into view');
});

test('a button that is really covered by something else is still not safe, in view or not', async () => {
  assert.equal((await inspect(fakePage({top: 200, viewport: 413, coveredBy: {tagName: 'DIV'}}))).safe, false);
  assert.equal((await inspect(fakePage({top: 464, viewport: 413, coveredBy: {tagName: 'DIV'}}))).safe, false);
});

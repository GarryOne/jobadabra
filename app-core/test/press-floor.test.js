// The press floor (extension/page/submit-press.js): the extension never presses a control that deletes an account or data, withdraws an application or signs out, nor one that declines inside a dialog that is no cookie notice
// (15 Oct 2026, owner's Chrome: the "Decline" of a Data Privacy Consent Statement opened "Delete All Data"). One loop over the press paths and the controls; a real cookie banner is still closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

// [what it is, dialog markup, the button's label, is it pressed?]
const CASES = [
  ['a privacy consent statement\'s Decline', '<div role="dialog"><p>Data Privacy Consent Statement. I consent to the processing of my personal data.</p><button>Accept</button><button>Decline</button><button>Print</button></div>', 'Decline', false],
  ['a statement that speaks of cookies and tracking too', '<div role="dialog"><h2>Data Privacy Consent Statement</h2><p>We process your personal data, cookies and tracking identifiers (GDPR).</p><button>Accept</button><button>Decline</button></div>', 'Decline', false],
  ['a reject in a terms dialog', '<div role="dialog"><p>Terms of use for applicants</p><button>Reject</button></div>', 'Reject', false],
  ['the follow-up "Delete All Data"', '<div role="dialog"><p>Warning! This action will permanently delete your account.</p><button>Delete All Data</button><button>Cancel</button></div>', 'Delete All Data', false],
  ['withdraw the application', '<div role="dialog"><p>Are you sure?</p><button>Withdraw application</button></div>', 'Withdraw application', false],
  ['sign out', '<div role="dialog"><p>Session over</p><button>Sign out</button></div>', 'Sign out', false],
  ['a German decline', '<div role="dialog"><p>Einwilligung zur Datenverarbeitung</p><button>Ablehnen</button></div>', 'Ablehnen', false],
  ['the Cancel of a delete warning (a plain close)', '<div role="dialog"><p>Warning! This will permanently delete your account.</p><button>Delete All Data</button><button>Cancel</button></div>', 'Cancel', true],
  ['a cookie banner\'s Reject all', '<div role="dialog"><p>We use cookies to improve your experience.</p><button>Accept all</button><button>Reject all</button></div>', 'Reject all', true],
  ['a cookie banner\'s Decline', '<div role="dialog"><p>This site uses cookies and tracking.</p><button>Decline</button></div>', 'Decline', true],
  ['a newsletter popup\'s No thanks', '<div role="dialog"><p>Join our newsletter</p><button>No thanks</button></div>', 'No thanks', true],
  ['a form radio "I decline" outside any dialog', '<form><label><input type="radio" id="r"> I decline</label></form>', 'I decline', true],
];

test('the press floor refuses what deletes, withdraws, signs out or declines a consent, and lets a plain close through', { skip: !JSDOM }, () => {
  for (const [what, markup, label, pressed] of CASES) {
    const { window } = openPage(JSDOM, markup);
    window.eval(read('extension/page/submit-press.js'));
    const el = [...window.document.querySelectorAll('button, input, label')].find((node) => (node.innerText || node.textContent).trim() === label);
    let clicked = 0;
    el.click = () => { clicked += 1; };
    assert.equal(window.__jobPilottoPress(el), true, what);
    assert.equal(clicked, pressed ? 1 : 0, `${what}: ${pressed ? 'must be pressed' : 'must be refused'}`);
    assert.equal(!!window.__jobPilottoRefused, !pressed, `${what}: refusal recorded`);
    window.close();
  }
});

// The press paths: each closer injects its page function and presses through the marked press (the other test in submit-press.test.js fails on a bare .click()), so the floor covers all of them.
test('every page-side press path ends in the marked press, which holds the floor', () => {
  const paths = ['extension/page/visit-page.js', 'extension/popup-page.js', 'extension/on-top.js', 'extension/account-fill.js', 'extension/next-step.js', 'extension/apply-press.js', 'extension/sections.js', 'extension/page/controls.js']
    .map((file) => (fs.existsSync(new URL(`../../${file}`, import.meta.url)) ? file : file.replace('extension/page/visit-page.js', 'extension/visit-page.js')));
  for (const file of paths) assert.match(read(file), /__jobPilottoPress\?\.\(/, `${file} presses through the marked press`);
  assert.match(read('extension/page/submit-press.js'), /refused\(el\)/, 'the marked press checks the floor');
});

// The cookie closer of the application flow (visit-page.js closeConsent, cookiesOnly): a privacy statement of the form is no cookie banner, a real banner still closes.
test('the application flow\'s cookie closer leaves a privacy statement alone and still closes a cookie banner', { skip: !JSDOM }, () => {
  const run = (markup) => {
    const { window } = openPage(JSDOM, markup);
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });   // jsdom has no layout text
    window.eval(`${read('extension/visit-page.js').replace(/^export /gm, '')}\nwindow.__out = closeConsent({cookiesOnly: true});`);
    const out = window.__out;
    window.close();
    return out;
  };
  const statement = '<div role="dialog"><h2>Data Privacy Consent Statement</h2><p>Your data, cookies and tracking by our recruiting system: GDPR.</p><button>Accept</button><button>Decline</button><button>Print</button></div>';
  assert.equal(run(statement), '', 'the statement\'s Decline is not pressed');
  assert.equal(run('<div role="dialog" id="cookie-banner"><p>We use cookies.</p><button>Accept all</button><button>Reject all</button></div>'), 'Reject all');
});

// The trusted (debugger) clicks of flow.js, fill-verify.js and ladder/fill-climb.js mark the element at the point first (markAt); false = the caller does not click.
test('a debugger click is refused on a submit, a decline in a statement and a delete control, and allowed on a field', { skip: !JSDOM }, () => {
  const CLICKS = [
    ['a Submit application button', '<form><button id="t">Submit application</button></form>', false],
    ['a type=submit button', '<form><button id="t" type="submit">Go</button></form>', false],
    ['a Decline in a privacy statement', '<div role="dialog"><h2>Data Privacy Consent Statement</h2><button id="t">Decline</button></div>', false],
    ['Delete All Data', '<div role="dialog"><button id="t">Delete All Data</button></div>', false],
    ['a text field', '<form><input id="t" type="text" value="Submit"></form>', true],
    ['a plain Next button', '<form><button id="t" type="button">Next</button></form>', true],
  ];
  for (const [what, markup, allowed] of CLICKS) {
    const { window } = openPage(JSDOM, markup);
    window.eval(read('extension/page/submit-press.js'));
    window.document.elementFromPoint = () => window.document.getElementById('t');
    assert.equal(window.__jobPilottoSubmitPress.markAt(5, 5), allowed, what);
    window.close();
  }
});

// The three debugger-click callers honour the answer; the filter reader sends only search-shaped forms.
test('every debugger click caller skips a refused point, and the filter reader\'s submit is search-shaped', () => {
  for (const file of ['extension/flow.js', 'extension/fill-verify.js', 'extension/ladder/fill-climb.js']) assert.match(read(file), /markAt\([^)]*\)[^\n]*?(=== false|result === false)/, `${file} skips a refused point`);
  const visit = read('extension/visit-page.js');
  assert.equal((visit.match(/\.requestSubmit\?\.\(\)/g) || []).length, 1, 'one requestSubmit, inside searchSubmit');
  assert.match(visit, /const searchSubmit = form =>/);
});

// The filter reader's submit (visit-page.js applyFilters): a search-shaped form is sent, an application-shaped one never.
test('the filter reader sends a search form and never an application form', { skip: !JSDOM }, async () => {
  const run = async (markup) => {
    const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, { url: 'https://jobs.example/search', pretendToBeVisual: true });
    const keep = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, location: globalThis.location };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), location: dom.window.location });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 120, height: 30, top: 0, left: 0, bottom: 30, right: 120 });
    dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 120, height: 30 }];
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return dom.window.document.body; } });
    globalThis.CSS = { escape: (value) => String(value).replace(/["\\\]\[]/g, '\\$&') };
    const events = { Event: dom.window.Event, KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent }, was = Object.fromEntries(Object.keys(events).map((name) => [name, globalThis[name]]));
    Object.assign(globalThis, events);
    let sent = 0;
    dom.window.document.querySelector('form').requestSubmit = () => { sent += 1; };
    try {
      const { applyFilters } = await import('../../extension/visit-page.js');
      await applyFilters([{ control: 'c1', action: 'type', value: 'Zurich' }]);
    } finally { Object.assign(globalThis, keep, was); }
    return sent;
  };
  assert.equal(await run('<form><input data-jp-control="c1" type="text" aria-label="Where"></form>'), 1, 'a search form is sent');
  assert.equal(await run('<form><input data-jp-control="c1" type="text" aria-label="Where"><input type="email" aria-label="Email"><textarea></textarea></form>'), 0, 'an application-shaped form is never sent');
  assert.equal(await run('<form><input data-jp-control="c1" type="text" aria-label="Where"><input type="file"></form>'), 0, 'a form with a file is never sent');
});

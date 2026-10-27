// The visit reader in any language (extension/visit-page.js): a cookie banner's own buttons listed for the app to pick by meaning and the one it
// picked pressed by its exact label; the controls Claude may name as the next page include ones no English word knows (8 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { loadJsdom } from './helpers/page.js';

const JSDOM = await loadJsdom();

async function inPage(html, run) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://emprego.example/ofertas', pretendToBeVisual: true });
  const keep = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, location: globalThis.location };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), location: dom.window.location });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });   // jsdom has no layout text
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 120, height: 30, top: 0, left: 0, bottom: 30, right: 120 });
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 120, height: 30 }];
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return dom.window.document.body; } });
  try { return await run(await import('../../extension/visit-page.js'), dom.window); } finally { Object.assign(globalThis, keep); }
}

test('a Portuguese cookie banner: its buttons are listed, and the one picked by meaning is pressed by its exact label', { skip: !JSDOM }, async () => {
  const banner = '<div role="dialog" id="cookie-banner"><p>Utilizamos cookies para melhorar a sua experiência.</p>'
    + '<button id="all">Aceitar todos</button><button id="none">Rejeitar não essenciais</button><a href="/privacidade">Saber mais</a></div>';   // a link that leaves the page is no dismiss control: never listed
  await inPage(banner, ({ closeConsent }, win) => {
    let pressed = '';
    win.document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed = b.id; }));
    assert.equal(closeConsent(), '', 'no word of the built-in lists knows these buttons');
    assert.deepEqual(closeConsent({ list: true }), ['Aceitar todos', 'Rejeitar não essenciais']);
    assert.equal(closeConsent({ press: 'Rejeitar não essenciais' }), 'Rejeitar não essenciais');
    assert.equal(pressed, 'none');
    assert.equal(closeConsent({ press: 'Not on this banner' }), '');
  });
});

test('the next page Claude may name: a Portuguese "Seguinte" is offered, an Apply button never', { skip: !JSDOM }, async () => {
  const list = '<ul><li class="job"><a href="/o/1">Programador</a></li><li class="job"><a href="/o/2">Analista</a></li><li class="job"><a href="/o/3">Gestor</a></li></ul>'
    + '<nav><a href="/ofertas?p=1">1</a><a href="/ofertas?p=2">Seguinte</a><button>Candidatar agora</button><button>Apply now</button></nav>';
  await inPage(list, ({ pageOutline }) => {
    const labels = pageOutline().pager.map((item) => item.label);
    assert.ok(labels.includes('1') && labels.includes('Seguinte'), labels.join(' | '));
    assert.ok(!labels.includes('Apply now'));
  });
});

// The application flow (extension/consent.js, cookiesOnly): a dialog over the form that speaks of cookies is closed with its least-consent button
// (Deloitte, 9 Oct 2026: "Decline optional cookies"); a privacy or terms box of the form itself is never touched.
test('cookiesOnly: a cookie dialog over a form is declined, a privacy agreement box is left alone', { skip: !JSDOM }, async () => {
  const cookies = '<div role="dialog"><p>Deloitte uses strictly necessary cookies and similar technologies.</p>'
    + '<button id="a">Accept optional cookies</button><button id="d">Decline optional cookies</button><button id="c">Customise Cookies</button></div>';
  await inPage(cookies, ({ closeConsent }, win) => {
    let pressed = '';
    win.document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed = b.id; }));
    assert.equal(closeConsent({ cookiesOnly: true }), 'Decline optional cookies');
    assert.equal(pressed, 'd');
  });
  const privacy = '<div role="dialog"><p>I have read the privacy policy and agree to the processing of my application data.</p><button id="a">I agree</button></div>';
  await inPage(privacy, ({ closeConsent }, win) => {
    let pressed = '';
    win.document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed = b.id; }));
    assert.equal(closeConsent({ cookiesOnly: true }), '');
    assert.deepEqual(closeConsent({ list: true, cookiesOnly: true }), []);
    assert.equal(pressed, '');
  });
});

test('the application flow closes a cookie banner before it reads the page, only cookies', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  assert.match(flow, /closeConsentEverywhere\(tab\.id, \{cookiesOnly: true\}\)/);
  assert.ok(flow.indexOf('closeConsentEverywhere(tab.id') < flow.indexOf('await expandSections(live)'));
});

test('the fill ends in a stuck report when nothing was filled and required fields are left; the CV reason says what happened', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  assert.match(flow, /!\(result\?\.filled > 0\) && result\?\.unfilledRequired > 0 && open\.length/);
  assert.match(flow, /deadEndHere\(tab, jobUrl, host, 'incomplete',/, 'the incomplete dead end (ladder/dead-end.js)');
  const fill = fs.readFileSync(new URL('../../extension/page/fill.js', import.meta.url), 'utf8');
  assert.match(fill, /resume\?\.data \? 'no place to attach it was found on this page' : 'no CV in the app'/);
});

// 9 Oct 2026: a refresh of a form tab did nothing (one fill per tab and page, for the life of the tab) and there was no button to start it.
test('a refresh looks at the page again, and the popup has a permanent Apply for a tab the app opened', () => {
  const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');
  assert.match(read('tab-report.js'), /onCommitted\.addListener\(details => \{\s*if \(details\.frameId !== 0 \|\| details\.transitionType !== 'reload'\) return;\s*tabReloaded\(details\.tabId\)/);
  // The Apply press is tried again after a refresh (forgetApplyTries on reload), never after every press: a posting whose Apply opened the form in another tab
  // must not press it a second time (beta e2e applycv on Windows, 10 Oct 2026: the second tab was not linked to the job, no kit).
  assert.match(read('tab-report.js'), /transitionType !== 'reload'\) return;\s*tabReloaded\(details\.tabId\)/);
  assert.match(read('fill-flow.js'), /export const tabReloaded = tabId => \{\s*retireFill\(tabId\);\s*forgetApplyTries\(tabId\);/);
  assert.doesNotMatch(read('fill-flow.js'), /noteRole\(tab\.id, tab\.url, role\); triedApply\.delete/);
  assert.match(read('popup.html'), /id="apply-here" hidden/);
  assert.match(read('popup.js'), /show\(popupControls\(mode\)\);[\s\S]*type: 'applyHere'/);   // shown through the one gate (popup-controls.js: 'apply-here' on a tab opened to apply)
  const messages = read('messages-panel.js');
  assert.match(messages, /message\?\.type === 'applyHere'[\s\S]*#jobpilotto-fill[\s\S]*not opened by the Jobadabra app/);
});

// 10 Oct 2026: the popup's "Apply on this page" cleared `started` but not the "Apply already pressed on this page" memory (dede94a clears that on a reload only), so on a page
// whose Apply press had been tried once, nothing was filled. Seen on the real Deloitte page (before: not filled, after: filled). The fixture test cannot tell (its input is visible at once).
test('the popup\'s Apply on this page forgets the tried Apply press, only for the person\'s own press', () => {
  const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');
  const messages = read('messages-panel.js');
  // Why (#2221, 27 Oct 2026): checks the imported names, in any import line from fill-flow.js; an exact line text went red when another name joined that import.
  const fromFillFlow = [...messages.matchAll(/import \{([^}]*)\} from '\.\/fill-flow\.js'/g)].flatMap(m => m[1].split(',').map(name => name.trim()));
  for (const name of ['consider', 'tabReloaded']) assert.ok(fromFillFlow.includes(name), `messages-panel.js imports ${name} from ./fill-flow.js`);
  assert.match(messages, /message\?\.type === 'applyHere'[\s\S]*tabReloaded\(tab\.id\);[\s\S]*consider\(tab, await jobOf\(tab\)\)/);
  assert.equal([...read('fill-flow.js').matchAll(/forgetApplyTries\(/g)].length, 1, 'fill-flow.js calls it only inside tabReloaded: never by itself after an Apply press');
});

// jobs.ch, 10 Oct 2026: the banner's "Cookie notice" link was picked as the dismiss button; it opened a new tab, whose banner did the same: a loop of tabs.
// The floor is structure: a link to another address or a new tab is never a dismiss control, whatever its words or what the AI picks; "#" and script links are.
test('a link that leaves the page is never a dismiss control (listed, pressed or matched by a word rule)', { skip: !JSDOM }, async () => {
  const banner = '<div class="cookie-notice"><p>This website uses cookies. See our Terms of Use and the Cookie notice.</p>'
    + '<a id="terms" href="/en/terms">Terms of Use</a><a id="more" href="/en/privacy-policy/#cookie-notice" target="_blank">Cookie notice</a>'
    + '<a id="ok" href="#">OK</a><a id="js" href="javascript:void(0)">Accept</a><a id="same" href="/ofertas#top">Got it</a></div>';
  await inPage(banner, ({ closeConsent }, win) => {
    const clicked = [];
    win.document.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { clicked.push(a.id); e.preventDefault(); }));
    assert.deepEqual(closeConsent({ list: true }), ['OK', 'Accept', 'Got it']);
    assert.equal(closeConsent({ press: 'Cookie notice' }), '');
    assert.equal(closeConsent({ press: 'Terms of Use' }), '');
    assert.deepEqual(clicked, []);
    assert.equal(closeConsent(), 'OK');
    assert.deepEqual(clicked, ['ok']);
  });
});

test('a cookie banner drawn inside an open shadow root (Usercentrics) is found, listed and pressed (Hornbach, 11 Oct 2026)', { skip: !JSDOM }, async () => {
  await inPage('<main><a>Apply</a></main><div id="usercentrics-root"></div>', ({ closeConsent }, win) => {
    const shadow = win.document.getElementById('usercentrics-root').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div role="dialog"><h2>Wir verwenden Cookies!</h2><button id="no">Alles ablehnen</button><button id="yes">Alles akzeptieren</button></div>';
    let pressed = '';
    shadow.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed = b.id; }));
    assert.equal(win.document.querySelectorAll('button').length, 0, 'the light DOM has no button: the banner is only in the shadow root');
    assert.deepEqual(closeConsent({ list: true, cookiesOnly: true }), ['Alles ablehnen', 'Alles akzeptieren']);
    assert.equal(closeConsent({ press: 'Alles ablehnen', cookiesOnly: true }), 'Alles ablehnen');
    assert.equal(pressed, 'no');
  });
});

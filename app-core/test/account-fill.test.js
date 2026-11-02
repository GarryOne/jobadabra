// The boxes the extension fills on a sign-in or sign-up page (extension/account-fill.js): the email and the password, found by what they
// are, empty and visible ones only, in any language.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {fillAccountBoxes} from '../../extension/account-fill.js';

function run(html, password) {
  const dom = new JSDOM(`<body>${html}</body>`);
  const {window} = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.hasAttribute('hidden') ? [] : [{}]; };   // jsdom has no layout
  Object.assign(globalThis, {document: window.document, HTMLInputElement: window.HTMLInputElement, Event: window.Event});
  const filled = fillAccountBoxes(password);
  const value = id => window.document.getElementById(id).value;
  return {filled, value};
}

test('a sign-up page: every empty visible password box gets the password, whatever the labels say; nothing else is touched', () => {
  const {filled, value} = run('<label>Adresse e-mail</label><input id="e" type="email"><input id="p1" type="password"><input id="p2" type="password"><input id="n" type="text">', 'Maple-42');
  assert.equal(filled, 2);
  assert.deepEqual([value('e'), value('p1'), value('p2'), value('n')], ['', 'Maple-42', 'Maple-42', '']);
});

test('boxes already filled, hidden or read-only are left alone', () => {
  const {filled, value} = run('<input id="h" type="password" hidden><input id="r" type="password" readonly><input id="k" type="password" value="mine">', 'p');
  assert.equal(filled, 0);
  assert.deepEqual([value('h'), value('r'), value('k')], ['', '', 'mine']);
});

import {pressAccountButton} from '../../extension/account-fill.js';

function press(html) {
  const {document, Node} = (() => { const dom = new JSDOM(`<body>${html}</body>`); dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; }; return dom.window; })();
  Object.assign(globalThis, {document, Node});
  let clicks = 0;
  document.querySelectorAll('button, input[type=submit]').forEach(button => button.addEventListener('click', event => { clicks++; event.preventDefault(); }));
  document.querySelector('input[type=password]')?.setAttribute('data-jobadabra-filled', '1');
  return {reason: pressAccountButton(), clicks: () => clicks};
}

test('a sign-in form with nothing left for the person: its one button is pressed, once', () => {
  const {reason, clicks} = press('<form><input type="text" value="a@b.c"><input type="password" value="x"><button type="submit">Anmelden</button></form>');
  assert.equal(reason, 'pressed');
  assert.equal(clicks(), 1);
  assert.equal(pressAccountButton(), 'already-pressed');
});

test('not pressed: a required box or consent still empty, a frame in the form (a bot check, whoever makes it), two buttons, or nothing filled by us', () => {
  const form = inner => `<form><input type="password" value="x">${inner}</form>`;
  assert.equal(press(form('<input type="checkbox" required><button>Go</button>')).reason, 'needs-you');
  assert.equal(press(form('<iframe src="https://anything.example/widget"></iframe><button>Go</button>')).reason, 'bot-check');
  assert.equal(press(form('<button>Go</button><button>Other</button>')).reason, 'several-buttons');
  assert.equal(press(form('')).reason, 'no-button');
  const none = new JSDOM('<form><input type="password"><button>Go</button></form>').window;
  Object.assign(globalThis, {document: none.document});
  assert.equal(pressAccountButton(), 'not-filled');
});

// jobs.ch, 9 Oct 2026: an email-first sign-up (no password box until the next step); the fill typed the email, the AI said ready, the press refused ("not-filled").
test('an email-first account page: pressed when the fill typed its email, never when we filled nothing', () => {
  const page = mark => new JSDOM(`<body><form><input type="email" id="e" value="a@b.c" ${mark}><button type="submit">Continue</button></form></body>`).window;
  for (const [mark, want] of [['data-jobadabra-filled', 'pressed'], ['', 'not-filled']]) {
    const win = page(mark);
    win.HTMLElement.prototype.getClientRects = function () { return [{}]; };
    let clicks = 0;
    win.document.querySelector('button').addEventListener('click', event => { clicks++; event.preventDefault(); });
    Object.assign(globalThis, {document: win.document, Node: win.Node});
    assert.equal(pressAccountButton(), want);   // the form's one submit button (jsdom has no innerText to match a name by)
    assert.equal(clicks, want === 'pressed' ? 1 : 0);
  }
});

import {passwordWork} from '../../extension/account-fill.js';

test('the cheap look before anything is asked of the app: how many password boxes, how many empty, whether a press of ours is still waiting', () => {
  const look = html => { const dom = new JSDOM(`<body>${html}</body>`); dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; }; Object.assign(globalThis, {document: dom.window.document}); return passwordWork(); };
  assert.deepEqual(look('<input type="password"><input type="password" value="x">'), {boxes: 2, empty: 1, pending: false});
  assert.deepEqual(look('<input type="password" value="x" data-jobadabra-filled="1">'), {boxes: 1, empty: 0, pending: true});   // ours, its button not pressed yet
  assert.deepEqual(look('<p>An account already exists</p>'), {boxes: 0, empty: 0, pending: false});   // a notice page has none: still looked at
});

import {pressRegister, pressConsent} from '../../extension/account-fill.js';

function pressNamed(html, named) {
  const {window} = new JSDOM(`<body>${html}</body>`);
  window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  Object.assign(globalThis, {document: window.document});
  const clicked = [];
  window.document.querySelectorAll('a, button').forEach(el => el.addEventListener('click', event => { event.preventDefault(); clicked.push(el.id); }));
  return {result: pressRegister(named), clicked};
}

test('a control named a little long or short is pressed when it is the only near match; several near ones are not guessed', () => {
  assert.deepEqual(pressNamed('<a id="a">Mein Profil</a><a id="b">Hilfe</a>', 'Anmelden / Mein Profil'), {result: 'pressed', clicked: ['a']});
  assert.deepEqual(pressNamed('<a id="a">Anmelden</a><a id="b">Anmelden mit Google</a>', 'Anmelden'), {result: 'pressed', clicked: ['a']});   // the exact one wins
  assert.deepEqual(pressNamed('<a id="a">Mein Profil</a><a id="b">Mein Profil neu</a>', 'Profil'), {result: 'several', clicked: []});
  assert.deepEqual(pressNamed('<a id="a">Hilfe</a>', 'Anmelden'), {result: 'not-found', clicked: []});
});

test('the account button named twice: the one beside the filled box is pressed, the header\'s is not (Richemont, 16 Oct 2026: the first "Sign In" opened a pop-up)', () => {
  const run = (html, named) => {
    const dom = new JSDOM(`<body>${html}</body>`);
    dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
    Object.assign(globalThis, {document: dom.window.document, Node: dom.window.Node});
    const clicked = [];
    dom.window.document.querySelectorAll('button').forEach(el => el.addEventListener('click', event => { event.preventDefault(); clicked.push(el.id); }));
    dom.window.document.querySelector('input[type=password]').setAttribute('data-jobadabra-filled', '1');
    return {reason: pressAccountButton(named), clicked};
  };
  const page = tail => `<header><div><button id="head" aria-label="Sign In"></button></div></header><main><form><input type="text" value="a@b.c"><input type="password" value="x">${tail}</form></main>`;
  assert.deepEqual(run(page('<button id="body" type="submit" aria-label="Sign In"></button>'), 'Sign In'), {reason: 'pressed', clicked: ['body']});
  assert.deepEqual(run('<main><form><input type="password" value="x"></form><div><button id="a" aria-label="Sign In"></button><button id="b" aria-label="Sign In"></button></div></main>', 'Sign In'), {reason: 'several-buttons', clicked: []});   // two equally near: never a guess
});

test('a button and its hidden twin (a click overlay over an aria-hidden submit button): the one a person presses is pressed, for every press that names a control', () => {
  const overlay = '<div role="button" aria-label="Sign In" id="overlay"></div><button type="submit" id="real" aria-hidden="true" aria-label="Sign In"></button>';
  const page = `<header><button id="head" aria-label="Sign In"></button></header><main><form><input type="text" value="a@b.c"><input type="password" value="x"><div>${overlay}</div></form></main>`;
  const dom = new JSDOM(`<body>${page}</body>`);
  dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  Object.assign(globalThis, {document: dom.window.document, Node: dom.window.Node});
  const clicked = [];
  dom.window.document.querySelectorAll('button, [role=button]').forEach(el => el.addEventListener('click', event => { event.preventDefault(); clicked.push(el.id); }));
  dom.window.document.querySelector('input[type=password]').setAttribute('data-jobadabra-filled', '1');
  assert.equal(pressAccountButton('Sign In'), 'pressed');
  assert.deepEqual(clicked, ['overlay']);
  const twin = '<main><form><input type="email"></form><div><a id="vis">Sign In</a><a id="hid" aria-hidden="true">Sign In</a></div></main>';
  for (const press of [pressRegister, pressConsent]) {
    const again = new JSDOM(`<body>${twin}</body>`);
    again.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
    Object.assign(globalThis, {document: again.window.document});
    const hits = [];
    again.window.document.querySelectorAll('a').forEach(el => el.addEventListener('click', event => { event.preventDefault(); hits.push(el.id); }));
    assert.equal(press('Sign In'), 'pressed', press.name);
    assert.deepEqual(hits, ['vis'], press.name);
  }
});

// The shape of a create-account page whose header and body both carry the text the AI named (captured 16 Oct 2026: a header "Sign In" button, the form, then "Already have an account? Sign In").
const TWO_SIGN_INS = '<header><div><button id="head">Sign In</button></div></header><main><form><input type="email"><input type="password"><button type="submit">Create Account</button></form><div>Already have an account?<button id="body">Sign In</button></div></main>';

test('several controls with the named text: the one beside the page\'s fields is pressed, never a guess when none is nearer', () => {
  assert.deepEqual(pressNamed(TWO_SIGN_INS, 'Sign In'), {result: 'pressed', clicked: ['body']});
  assert.deepEqual(pressNamed('<main><form><input type="email"></form><div><button id="a">Sign In</button><button id="b">Sign In</button></div></main>', 'Sign In'), {result: 'several', clicked: []});   // two equally near: still not guessed
  assert.deepEqual(pressNamed('<header><a id="a">Sign In</a></header><footer><a id="b">Sign In</a></footer>', 'Sign In'), {result: 'several', clicked: []});   // no fields on the page: nothing to be beside
});

test('a consent named twice resolves the same way', () => {
  const {window} = new JSDOM(`<body><header><a id="head">Privacy statement</a></header><main><form><input type="email"></form><p><a id="body">Privacy statement</a></p></main></body>`);
  window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  Object.assign(globalThis, {document: window.document});
  const clicked = [];
  window.document.querySelectorAll('a').forEach(el => el.addEventListener('click', event => { event.preventDefault(); clicked.push(el.id); }));
  assert.equal(pressConsent('Privacy statement'), 'pressed');
  assert.deepEqual(clicked, ['body']);
});

test('the two presses are self-contained: injected into a page alone, they still resolve a repeated control', () => {
  for (const [fn, name, html] of [[pressRegister, 'Sign In', TWO_SIGN_INS], [pressConsent, 'Sign In', TWO_SIGN_INS]]) {
    const {window} = new JSDOM(`<body>${html}</body>`, {runScripts: 'outside-only'});
    window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
    const clicked = [];
    window.document.querySelectorAll('button').forEach(el => el.addEventListener('click', event => { event.preventDefault(); clicked.push(el.id); }));
    const alone = window.eval(`(${fn.toString()})`);   // only the function's own text, as chrome.scripting.executeScript sends it
    assert.equal(alone(name), 'pressed', fn.name);
    assert.deepEqual(clicked, ['body'], fn.name);
  }
});

import {markAccountStep} from '../../extension/account-fill.js';

test('the AI\'s page step is left on the page for the panel, and removed when there is none', () => {
  const {window} = new JSDOM('<body></body>');
  Object.assign(globalThis, {document: window.document});
  markAccountStep('sign_in');
  assert.equal(window.document.documentElement.getAttribute('data-jobadabra-account-step'), 'sign_in');
  markAccountStep('');
  assert.equal(window.document.documentElement.hasAttribute('data-jobadabra-account-step'), false);
});

import {fillAccountEmail} from '../../extension/account-fill.js';
function signIn(html) {
  const {window} = new JSDOM(`<body>${html}</body>`);
  window.HTMLElement.prototype.getClientRects = function () { return this.hasAttribute('hidden') ? [] : [{}]; };
  Object.assign(globalThis, {document: window.document, HTMLInputElement: window.HTMLInputElement, Event: window.Event, Node: window.Node});
  return window.document;
}
test('a sign-in page: the one empty text or email box ahead of the password box gets the email, once; anything less certain is left alone', () => {
  let doc = signIn('<form><input id="e" type="text"><input id="p" type="password"></form>');
  assert.equal(fillAccountEmail('me@example.test'), 1);
  assert.deepEqual([doc.getElementById('e').value, doc.getElementById('e').hasAttribute('data-jobadabra-filled')], ['me@example.test', true]);
  doc = signIn('<form><input id="e" type="email" value="other@example.test"><input id="p" type="password"></form>');
  assert.equal(fillAccountEmail('me@example.test'), 0);   // a box that holds something is never overwritten
  assert.equal(doc.getElementById('e').value, 'other@example.test');
  signIn('<form><input id="a" type="text"><input id="b" type="text"><input id="p" type="password"></form>');
  assert.equal(fillAccountEmail('me@example.test'), 0);   // two candidates: not a sign-in's lone username box
  signIn('<form><input id="p" type="password"><input id="after" type="text"></form>');
  assert.equal(fillAccountEmail('me@example.test'), 0);   // a box AFTER the password is not the username
  signIn('<form><input id="e" type="text"></form>');
  assert.equal(fillAccountEmail('me@example.test'), 0);   // no password box: not a sign-in
  assert.equal(fillAccountEmail(''), 0);
});

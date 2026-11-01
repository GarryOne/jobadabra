// A click only counts as "submit pressed" when it submits (extension/page/submit-press.js, used by review.js): an explicit type=submit control, the form's own submit event, or
// the Submit floor's words. A button with NO type attribute reports .type === "submit" in every browser, so an answer button (a Yes/No choice, "Next", "Add another") used to start the
// submission watch and could lead to a false "applied" (11 Oct 2026, live: an answer button on an application form logged "submit pressed"). One loop over every kind of control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

// [what it is, the control's markup, does a click on it count?]
const CONTROLS = [
  ['a typeless answer button the page keeps from submitting (Yes)', '<button id="x" aria-pressed="false" data-page-handles>Yes</button>', false],
  ['a typeless button with a neutral name, click handled by the page', '<button id="x" data-page-handles>Add another</button>', false],
  ['a typeless button wrapping a span, click handled by the page', '<button id="x" data-page-handles><span>No</span></button>', false],
  ['a typeless button outside any form', '</form><button id="x">Yes</button><form>', false],
  ['a type=button control', '<button id="x" type="button">Next</button>', false],
  ['a type=reset control', '<button id="x" type="reset">Clear</button>', false],
  ['a role=button div', '<div id="x" role="button">Yes</div>', false],
  ['an input type=button', '<input id="x" type="button" value="Choose">', false],
  ['an explicit type=submit button', '<button id="x" type="submit">Go</button>', true],
  ['an input type=submit', '<input id="x" type="submit" value="Go">', true],
  ['an input type=image', '<input id="x" type="image" alt="Go">', true],
  ['an explicit TYPE=SUBMIT in capitals', '<button id="x" type="SUBMIT">Go</button>', true],
  ['a typeless button the form submits (the form\'s real submit event)', '<button id="x">Send</button>', true],
  ['a button the page labels as the form\'s submit', '<button id="x" type="button">Submit application</button>', true],
  ['a role=button labelled as the submit', '<div id="x" role="button">Submit</div>', true],
];

const SEND = '<button id="x">Send</button>';
async function sentAfterClick(markup) {
  const { window } = openPage(JSDOM, `<form><label for="n">Name *</label><input id="n" required value="Ada">${markup}</form>`);
  const sent = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : {}; }, onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.eval(read('extension/page/submit-press.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.document.addEventListener('click', (event) => { if (event.target.closest('[data-page-handles]')) event.preventDefault(); });   // the page's own handler: the click does not submit
  window.document.addEventListener('submit', (event) => event.preventDefault());
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  click.__jpTrusted = true;
  window.document.getElementById('x').dispatchEvent(click);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.close();
  return sent.filter((message) => message.type === 'submitted').length;
}

test('only a control that submits counts as "submit pressed"; an answer button never does', { skip: !JSDOM }, async () => {
  for (const [name, markup, counts] of CONTROLS) {
    const noted = await sentAfterClick(markup);
    assert.equal(noted > 0, counts, `${name}: ${noted} "submitted" message(s)`);
  }
});

test('a typeless button whose click really submits the form is noticed once, not twice', { skip: !JSDOM }, async () => {
  assert.equal(await sentAfterClick(SEND), 1);
});

test('a form submitted by a script (no click) is still noticed', { skip: !JSDOM }, async () => {
  const { window } = openPage(JSDOM, '<form id="f"><input id="n" value="Ada"><button type="button">Yes</button></form>');
  const sent = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : {}; }, onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.eval(read('extension/page/submit-press.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.document.getElementById('f').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.close();
  assert.equal(sent.filter((message) => message.type === 'submitted').length, 1);
});

test('a typeless button whose click handler calls form.requestSubmit() is noticed (the submit event fires)', { skip: !JSDOM }, async () => {
  const { window } = openPage(JSDOM, '<form id="f"><input id="n" value="Ada"><button id="x">Continue</button></form>');
  const sent = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : {}; }, onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.eval(read('extension/page/submit-press.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.document.addEventListener('submit', (event) => event.preventDefault());
  window.document.getElementById('x').addEventListener('click', (event) => { event.preventDefault(); window.document.getElementById('f').requestSubmit(); });
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  click.__jpTrusted = true;
  window.document.getElementById('x').dispatchEvent(click);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.close();
  assert.equal(sent.filter((message) => message.type === 'submitted').length, 1);
});

// A press the extension itself makes (a cookie banner's closer, a route press, a menu open) is a script's click: never the person's submit (13 Oct 2026, QA evidence H&M and
// Databricks: the fill's popup press sat in a <form> and logged "submit pressed" in the same ms as "closed a popup"). One loop over every kind of control a script presses.
async function sentAfterOwnPress(markup) {
  const { window } = openPage(JSDOM, `<form><label for="n">Name *</label><input id="n" required value="Ada">${markup}</form>`);
  const sent = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : {}; }, onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.eval(read('extension/page/submit-press.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.document.addEventListener('submit', (event) => event.preventDefault());
  window.__jobPilottoPress(window.document.getElementById('x'));   // the extension's own press (every press site goes through this helper)
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.close();
  return sent.filter((message) => message.type === 'submitted').length;
}

test('a press the extension makes never counts as "submit pressed", whatever control it presses', { skip: !JSDOM }, async () => {
  for (const [name, markup] of CONTROLS) assert.equal(await sentAfterOwnPress(markup), 0, `${name}: the extension's own press sent "submitted"`);
});

test('the person pressing right after the extension still counts (the own press does not mute the next one)', { skip: !JSDOM }, async () => {
  const { window } = openPage(JSDOM, '<form><input id="n" value="Ada"><button id="closer" type="submit">Reject all</button><button id="x" type="submit">Go</button></form>');
  const sent = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : {}; }, onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.eval(read('extension/page/submit-press.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.document.addEventListener('submit', (event) => event.preventDefault());
  window.__jobPilottoPress(window.document.getElementById('closer'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sent.filter((message) => message.type === 'submitted').length, 0);
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  click.__jpTrusted = true;
  window.document.getElementById('x').dispatchEvent(click);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.close();
  assert.ok(sent.filter((message) => message.type === 'submitted').length >= 1);
});

// The SITE's scripts click too: a styled "Send application" div whose handler clicks a hidden submit button is the person's submit, however that click was made (cc's review of #622).
test('a click the site\'s own script makes after the person pressed still counts as the submit', { skip: !JSDOM }, async () => {
  const { window } = openPage(JSDOM, '<form id="f"><input id="n" value="Ada"><div id="styled" role="button">Send</div><button id="hidden" type="submit" style="display:none">Go</button></form>');
  const siteClick = window.HTMLElement.prototype.click;   // what a page script calls: the page's own click, never the extension's press helper
  const sent = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : {}; }, onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.eval(read('extension/page/submit-press.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.document.addEventListener('submit', (event) => event.preventDefault());
  window.document.getElementById('styled').addEventListener('click', () => siteClick.call(window.document.getElementById('hidden')));
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  click.__jpTrusted = true;
  window.document.getElementById('styled').dispatchEvent(click);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.close();
  assert.ok(sent.filter((message) => message.type === 'submitted').length >= 1, 'the site\'s own hidden-submit click was swallowed');
});

// The class: every click the extension makes goes through the marked press, so a new `.click()` added without it fails here.
test('no extension file clicks a control without the marked press', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  const root = new URL('../../extension', import.meta.url).pathname;
  const bare = [];
  for (const file of walk(root).filter((name) => name.endsWith('.js') && !/\/(review|page\/submit-press)\.js$/.test(name))) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => { if (/\.click\(\)/.test(line.replace(/\/\/.*$/, '')) && !line.includes('__jobPilottoPress?.(')) bare.push(`${file.slice(root.length)}:${i + 1}`); });
  }
  assert.deepEqual(bare, [], 'a press without globalThis.__jobPilottoPress?.(el) || el.click()');
});

// The extension's debugger presses are trusted clicks at a point: the element there is marked first (markAt), the click that arrives is the extension's own, and the person's next one counts.
test('a debugger press the extension marked first never counts, the person\'s next click does', { skip: !JSDOM }, async () => {
  const { window } = openPage(JSDOM, '<form><input id="n" value="Ada"><button id="x">Reject all</button></form>');
  const sent = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : {}; }, onMessage: { addListener() {} } } };
  window.document.elementFromPoint = () => window.document.getElementById('x');   // jsdom has no layout
  window.eval(read('extension/page/skeleton.js'));
  window.eval(read('extension/page/submit-press.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.document.addEventListener('submit', (event) => event.preventDefault());
  const trusted = () => { const click = new window.MouseEvent('click', { bubbles: true, cancelable: true }); click.__jpTrusted = true; return click; };
  window.__jobPilottoSubmitPress.markAt(5, 5);
  await new Promise((resolve) => setTimeout(resolve, 100));   // the debugger click crosses processes: the mark waits for it
  window.document.getElementById('x').dispatchEvent(trusted());
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sent.filter((message) => message.type === 'submitted').length, 0, 'the extension\'s own debugger press counted');
  window.document.getElementById('x').dispatchEvent(trusted());   // the person, afterwards
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.close();
  assert.ok(sent.filter((message) => message.type === 'submitted').length >= 1, 'the person\'s click after it was muted');
});

test('every debugger press in the extension marks its element first', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  const root = new URL('../../extension', import.meta.url).pathname;
  const unmarked = walk(root).filter((name) => name.endsWith('.js') && fs.readFileSync(name, 'utf8').includes('Input.dispatchMouseEvent') && !fs.readFileSync(name, 'utf8').includes('markAt('));
  assert.deepEqual(unmarked.map((name) => name.slice(root.length)), [], 'a debugger click without __jobPilottoSubmitPress.markAt(x, y) first');
});

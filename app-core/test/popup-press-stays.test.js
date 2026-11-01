// A press that closes a popup or a layer leaves the tab on the same page (Duolingo, 13 Oct 2026: the popup judge picked "BACK TO HOME" and the tab went to the careers home, so a whole
// application was judged on the wrong page). Two floors, each over every place the extension presses a closer: the page-side `leavesPage` (the same text in popup-page.js, visit-page.js and
// on-top.js: a control inside a link to another page is never pressed) and consent.js pressStays (an address read before and after; a press that moved the tab is undone and logged).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { loadJsdom } from './helpers/page.js';

const JSDOM = await loadJsdom();
const read = (file) => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8');
const PRESS_SITES = ['popup-page.js', 'visit-page.js', 'on-top.js'];

test('every page-side press site carries the same leavesPage floor and uses it', () => {
  const texts = PRESS_SITES.map((file) => /const leavesPage = node => \{[^\n]*\};/.exec(read(file))?.[0]);
  for (const [index, text] of texts.entries()) assert.ok(text, `${PRESS_SITES[index]}: no leavesPage`);
  assert.equal(new Set(texts).size, 1, 'the three copies must be the same text');
  for (const file of PRESS_SITES) assert.match(read(file), /leavesPage\((item|node)\)/, `${file}: leavesPage is not applied`);
});

test('a closer inside a link to another page is not listed and not pressed', { skip: !JSDOM }, async () => {
  const dom = new JSDOM('<!doctype html><body><div role="dialog" style="position:fixed;z-index:99"><p>This job is closed. Cookies?</p>'
    + '<a href="/home"><span id="home" role="button">Back to home</span></a><button id="ok">Close</button></div></body>', { url: 'https://karriere.example/jobs/1', pretendToBeVisual: true });
  const keep = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, location: globalThis.location };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), location: dom.window.location });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, bottom: 400, right: 600 });
  try {
    const { findPopup } = await import('../../extension/popup-page.js');
    assert.deepEqual(findPopup({ list: true }).buttons, ['Close']);
    assert.equal(findPopup({ press: 'Back to home' }), '');
  } finally { Object.assign(globalThis, keep); }
});

test('pressStays: a press that moved the tab is undone and logged; one that did not, stays', async () => {
  const urls = []; let back = 0;
  globalThis.chrome = { tabs: { get: async () => ({ url: urls.shift() }), goBack: async () => { back++; } },
    storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } }, runtime: { getManifest: () => ({ version: '0' }) } };
  const { pressStays } = await import('../../extension/consent.js');
  const wait = async () => {};
  let forgot = 0;
  urls.push('https://x.example/jobs/1', 'https://x.example/');
  assert.equal(await pressStays(1, async () => 'BACK TO HOME', { wait, onMoved: () => { forgot++; } }), '', 'moved: not counted as pressed');
  assert.equal(back, 1);
  assert.equal(forgot, 1, 'the kept pick is forgotten, or the next look presses it again');
  urls.push('https://x.example/jobs/1', 'https://x.example/jobs/1#top');
  assert.equal(await pressStays(1, async () => 'Close', { wait }), 'Close');
  assert.equal(back, 1);
  urls.push('https://x.example/jobs/1');
  assert.equal(await pressStays(1, async () => '', { wait }), '', 'nothing pressed: nothing read after');
});

test('class: every closer press in consent.js goes through pressStays', () => {
  const source = read('consent.js');
  const presses = [...source.matchAll(/press: choice/g)].length + [...source.matchAll(/inFrames\(tabId, \[only\]\)/g)].length;
  const wrapped = [...source.matchAll(/pressStays\(tabId, async \(\) => [^\n]*(press: choice|inFrames\(tabId, \[only\]\))/g)].length;
  assert.ok(presses >= 4 && wrapped === presses, `${presses} press sites, ${wrapped} wrapped`);
});

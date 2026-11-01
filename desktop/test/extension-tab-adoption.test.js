// A tab joins an application only through the extension's own press on its opener (extension/tabs.js followOpener, same-tab.js pressedLately).
// 13 Oct 2026, the owner's own Chrome: tabs the PERSON opened (GitHub pull requests, ⌘-clicked from the open Ashby form) were adopted because Chrome named
// the form tab as their opener; the fill mark went on them and the form fill ran on a pull request ("pressed: false, ageMs: ''" was in the log, unread).
import assert from 'node:assert/strict';
import {test} from 'node:test';

const store = {};
globalThis.chrome = {runtime: {getManifest: () => ({version: 'test'}), sendMessage: async () => {}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {
  async get(keys) { return Object.fromEntries([].concat(keys).filter(key => key in store).map(key => [key, store[key]])); },
  async set(items) { Object.assign(store, items); },
  async remove(keys) { for (const key of [].concat(keys)) delete store[key]; },
}}};
const {followOpener, notePress, applyPressed, noteSource, navSources} = await import('../../extension/tabs.js');
const {FOLD_MS, pressedLately} = await import('../../extension/same-tab.js');

const FORM = 'https://jobs.ashbyhq.com/colonist/a8300c34/application';
const reset = () => { for (const key of Object.keys(store)) delete store[key]; applyPressed.clear(); navSources.clear(); };
const application = id => Object.assign(store, {[`armed:${id}`]: true, [`session:${id}`]: 'session-A', [`from:${id}`]: FORM});

test('a tab the person opens from the application\'s tab is the person\'s: not armed, no session, no job', async () => {
  reset(); application(1);
  assert.equal(await followOpener({id: 2, openerTabId: 1, url: 'https://github.com/GarryOne/jobadabra/pull/620', pendingUrl: ''}), false);   // Chrome names tab 1 its opener; no press of ours
  assert.equal(store['armed:2'], undefined);
  assert.equal(store['session:2'], undefined);
  assert.equal(store['from:2'], undefined);
});

test('the same tab, a moment after the extension pressed Apply on its opener: it follows', async () => {
  reset(); application(11);   // tab ids differ per test: a press stays noted for a few seconds
  notePress(11, FORM);
  assert.equal(await followOpener({id: 12, openerTabId: 11, url: '', pendingUrl: ''}), true);
  assert.equal(store['armed:12'], true);
  assert.equal(store['session:12'], 'session-A');
});

test('an Apply press recorded by the fill flow (applyPressed) counts too', async () => {
  reset(); application(21);
  applyPressed.set(21, {at: Date.now(), url: FORM});
  assert.equal(await followOpener({id: 22, openerTabId: 21, url: '', pendingUrl: ''}), true);
});

test('a press that is too old, or on another tab, never adopts', async () => {
  reset(); application(31); application(35);
  const now = 1_000_000;
  const presses = new Map([[31, {at: now - FOLD_MS - 1}], [35, {at: now - 1000}]]);
  assert.equal(pressedLately(31, presses, now), false);   // the person's tab, opened long after the last press
  assert.equal(pressedLately(35, presses, now), true);
  assert.equal(pressedLately(39, presses, now), false);   // another tab pressed, not this opener
  assert.equal(pressedLately(null, presses, now), false);
  notePress(35, FORM);
  assert.equal(await followOpener({id: 36, openerTabId: 31, url: '', pendingUrl: ''}), false);   // tab 35 pressed a moment ago, tab 36's opener is tab 31
});

test('the page that really created the tab is the one that must have pressed (two applications side by side)', async () => {
  reset(); application(41); application(45);
  notePress(45, FORM);
  noteSource({tabId: 46, sourceTabId: 41});   // the person's link click on tab 41's page, while tab 45 was in front and pressed
  assert.equal(await followOpener({id: 46, openerTabId: 45, url: '', pendingUrl: ''}), false);
});

test('every way a tab can become armed goes through followOpener\'s press rule: no other writer of armed: for a new tab', async () => {
  const {readFileSync} = await import('node:fs');
  const background = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  // onCreated is the one listener that arms a tab it did not open itself: it asks followOpener first.
  const onCreated = background.slice(background.indexOf('chrome.tabs.onCreated.addListener'));
  assert.match(onCreated.split('\n').slice(0, 3).join('\n'), /followOpener\(tab\)/);
  assert.equal([...background.matchAll(/chrome\.tabs\.onCreated\.addListener/g)].length, 1);
});

test('the class: every file whose background code clicks for the person\'s application says so first (notePress), so its new tab is followed and no other is', async () => {
  const {readFileSync, readdirSync} = await import('node:fs');
  const root = new URL('../../extension/', import.meta.url);
  const files = ['', 'ladder/'].flatMap(dir => readdirSync(new URL(dir, root)).filter(name => name.endsWith('.js')).map(name => dir + name));
  // A background file that hands a press function to the page (executeScript / run / press), not the page-side definition itself.
  const presser = /(?:func: pressInPage|\b(?:run|press)\(tab, frameId, press[A-Z]\w+|func: \(selector, index\) => \{)/;
  const clickers = files.filter(name => presser.test(readFileSync(new URL(name, root), 'utf8')));
  assert.ok(clickers.length >= 4, `expected the press sites, found ${clickers.join(', ')}`);
  for (const name of clickers) assert.match(readFileSync(new URL(name, root), 'utf8'), /notePress\(/, `${name} presses in a page without notePress`);
  // and the page-side hook next-move adds (__jobadabraPress) is not a way to open a followed tab: only these sites are
  assert.ok(clickers.includes('apply-press.js') && clickers.includes('next-step.js') && clickers.includes('account-step.js') && clickers.includes('ladder/rung4-picture.js'));
});

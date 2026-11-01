// A page the person (or the app, on their word) asked to load again is read and filled again: every once-per-page guard of the tab is forgotten through ONE helper, whichever way the reload reaches the worker (beta 12, 24 Oct 2026: the app's reload command shows up in Chrome as "link"/client_redirect, never "reload", so `started` kept the page).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

globalThis.chrome = {runtime: {id: 'x', getManifest: () => ({version: '0'}), onMessage: {addListener: () => {}}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}}};
const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');

test('tabReloaded forgets the tab\'s pages and its running fill, and no other tab\'s', async () => {
  const {initFillFlow, tabReloaded, fillKey} = await import('../../extension/fill-flow.js');
  const {oneFillPerTab} = await import('../../extension/one-fill.js');
  const started = new Set([7, fillKey(7, 'https://x.test/a'), fillKey(7, 'https://x.test/b'), fillKey(70, 'https://x.test/a')]);
  initFillFlow({started, fillOpenedTab: async () => null, reportFlow: async () => {}, onPage: async () => true});
  const removed = [];
  chrome.storage.session.remove = async keys => { removed.push(keys); };
  let ran = 0;
  const slow = () => new Promise(resolve => { ran++; setTimeout(resolve, 40); });
  oneFillPerTab(7, 'https://x.test/a', slow);
  await new Promise(resolve => setTimeout(resolve, 5));
  tabReloaded(7);
  assert.deepEqual([...started], [fillKey(70, 'https://x.test/a')]);
  assert.deepEqual(removed, ['handoff:7'], 'the night\'s hand-off is asked for again');
  oneFillPerTab(7, 'https://x.test/a', slow);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(ran, 2, 'the reloaded page starts its own fill, it does not join the old one');
});

test('every way a page is loaded again goes through tabReloaded', () => {
  assert.match(read('tab-report.js'), /transitionType !== 'reload'\) return;\s*tabReloaded\(details\.tabId\)/, 'Chrome\'s own reload');
  assert.match(read('messages-panel.js'), /'applyHere'[\s\S]*?tabReloaded\(tab\.id\)/, 'the popup\'s Apply on this page');
  assert.match(read('messages-panel.js'), /'panelReloading'[\s\S]*?tabReloaded\(sender\.tab\.id\)/, 'the app\'s reload command, told by the panel just before it reloads');
  assert.match(read('review.js'), /panelReloading[\s\S]{0,200}location\.reload\(\)/, 'the panel tells the worker before it reloads');
});

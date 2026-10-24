// The window's size: 80% on laptop-size displays, 100% above, remembered, stepped by ⌘+ ⌘-, Small/Default/Large per display, and no text under 10 px on screen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {choiceOf, defaultFactor, factorFor, factorOfChoice, step} from '../lib/zoom.js';
import {createZoom} from '../lib/zoom-handlers.js';
import {MIN_ON_SCREEN_PX, floorTokens} from '../renderer/zoom-view.js';

test('a 14" MacBook (1512 wide) starts at 80%, a larger display at 100%', () => {
  assert.equal(defaultFactor(1512), 0.8);
  assert.equal(defaultFactor(1280), 0.8);
  assert.equal(defaultFactor(1728), 1);
  assert.equal(defaultFactor(2560), 1);
  assert.equal(defaultFactor(0), 1);   // unknown: no change
});

test('a saved size wins over the display default, and a broken one is ignored', () => {
  assert.equal(factorFor({zoom: 1.1}, 1512), 1.1);
  assert.equal(factorFor({zoom: null}, 1512), 0.8);
  assert.equal(factorFor({zoom: 'big'}, 1512), 0.8);
  assert.equal(factorFor({zoom: 9}, 1512), 2);
  assert.equal(factorFor({}, 2560), 1);
});

test('⌘+ and ⌘- move one step and stop at the ends', () => {
  assert.equal(step(0.8, 1), 0.9);
  assert.equal(step(0.8, -1), 0.7);
  assert.equal(step(2, 1), 2);
  assert.equal(step(0.5, -1), 0.5);
});

test('Small < Default < Large on every display, and the choice is found again from the factor', () => {
  for (const width of [1280, 1512, 1728, 2560]) {
    const [small, normal, large] = ['small', 'default', 'large'].map(choice => factorOfChoice(choice, width));
    assert.ok(small < normal && normal < large, `${width}: ${small} ${normal} ${large}`);
    assert.equal(normal, defaultFactor(width));
    for (const choice of ['small', 'default', 'large']) assert.equal(choiceOf(factorOfChoice(choice, width), width), choice);
  }
  assert.equal(choiceOf(0.9, 1512), null);
});

test('the smallest text is never under 10 px on screen at any step', () => {
  for (const factor of [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 2]) {
    const floors = floorTokens(factor);
    for (const [name, base] of [['--fs-xs', 11], ['--fs-sm', 12]]) {
      const px = parseFloat(floors[name] ?? `${base}px`);
      assert.ok(px * factor >= MIN_ON_SCREEN_PX - 0.05, `${name} at ${factor}: ${px * factor}`);
    }
  }
  assert.deepEqual(floorTokens(1), {});
  const tokens = fs.readFileSync(new URL('../renderer/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /--fs-xs: 11px/); assert.match(tokens, /--fs-sm: 12px/);   // the numbers floorTokens starts from
});

function fake({width = 1512, settings = {}} = {}) {
  const calls = []; const store = {...settings};
  const win = {isDestroyed: () => false, getBounds: () => ({}), webContents: {setZoomFactor: value => calls.push(value)}};
  const zoom = createZoom({screen: {getDisplayMatching: () => ({workAreaSize: {width}}), getPrimaryDisplay: () => ({workAreaSize: {width}})}, getWindow: () => win,
    getStorage: () => ({settings: () => store, saveSettings: patch => Object.assign(store, patch)}), toWindow: () => {}});
  return {zoom, calls, store};
}

test('the size is applied at load, kept when changed, and comes back after a restart', () => {
  const first = fake();
  first.zoom.apply();
  assert.deepEqual(first.calls, [0.8]);
  first.zoom.zoomIn(); first.zoom.zoomIn();
  assert.equal(first.store.zoom, 1);
  const second = fake({settings: first.store});   // a new start with the saved settings
  second.zoom.apply();
  assert.deepEqual(second.calls, [1]);
  second.zoom.reset();
  assert.equal(second.calls.at(-1), 0.8);
  assert.equal(second.store.zoom, null);
});

test('Text size choices set the same setting', () => {
  const {zoom, store} = fake();
  assert.deepEqual(zoom.setChoice('large'), {factor: 1, choice: 'large', standard: 0.8});
  assert.equal(store.zoom, 1);
  assert.equal(zoom.setChoice('small').factor, 0.7);
});

test('the View menu keeps the zoom keys in the app, and the plain one stays when there is no zoom', async () => {
  const {template} = await import('../lib/app-menu.js');
  const calls = [], zoom = {reset: () => calls.push('reset'), zoomIn: () => calls.push('in'), zoomOut: () => calls.push('out')};
  const view = template({name: 'Jobadabra', mac: true, checkForUpdates() {}, zoom}).find(item => item.label === 'View');
  for (const label of ['Actual Size', 'Zoom In', 'Zoom Out']) view.submenu.find(item => item.label === label).click();
  assert.deepEqual(calls, ['reset', 'in', 'out']);
  assert.deepEqual(view.submenu.filter(item => item.accelerator).map(item => item.accelerator), ['CmdOrCtrl+0', 'CmdOrCtrl+Plus', 'CmdOrCtrl+-']);
  assert.ok(template({name: 'x', mac: true, checkForUpdates() {}}).some(item => item.role === 'viewMenu'));
});

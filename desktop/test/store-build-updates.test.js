// The Microsoft Store copy (MSIX, process.windowsStore) is updated by the Store, never by our own installer: running the .exe from inside it would put a
// second, non-Store copy beside it, and that installer is the one SmartScreen warns about (owner's goal, 26 Oct 2026: "Microsoft desktop app installing
// without warnings"). Every update surface that knows "running from source" also knows "from the Microsoft Store".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createAppUpdates} from '../lib/app-updates.js';
import {answer} from '../lib/app-menu.js';
import {betaText, testText, updateText} from '../renderer/update-text.js';

function storeUpdates() {
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { fetched.push(String(url)); throw new Error('no network in this test'); };
  const settings = {};
  const updates = createAppUpdates({Menu: {}, dialog: {}, track: () => {}, toWindow: () => {}, getWindow: () => null, getTelemetry: () => null, windowsStore: true,
    app: {isPackaged: true, getVersion: () => '0.8.28', getPath: () => '/x', quit: () => {}},
    getStorage: () => ({settings: () => settings, saveSettings: patch => Object.assign(settings, patch)})});
  return {updates, fetched, restore: () => { globalThis.fetch = realFetch; }};
}

test('the Store copy never looks for, offers or installs our own update', async () => {
  const {updates, fetched, restore} = storeUpdates();
  try {
    assert.equal(updates.FROM_STORE, true);
    assert.equal(await updates.checkForUpdate(), null, 'the automatic check offers nothing');
    assert.deepEqual(await updates.checkForUpdate(true), {ok: true, offer: null, current: '0.8.28', fromStore: true});
    updates.setUpdateOffer({version: '0.8.40', url: 'https://dl/x.exe'});
    const installed = await updates.installUpdate();
    assert.equal(installed.ok, false);
    assert.match(installed.text, /Microsoft Store/);
    assert.deepEqual(fetched, [], 'nothing was asked of GitHub or our site');
  } finally { restore(); }
});

test('the Store copy says where its updates come from, in the menu and in Settings', () => {
  const shown = answer({ok: true, offer: null, fromStore: true}, '0.8.28');
  assert.match(shown.message + shown.detail, /Microsoft Store/);
  assert.ok(!shown.install);
  assert.deepEqual(updateText({fromStore: true, offer: {version: '9'}}), {latest: true, text: 'Updated by the Microsoft Store'});
  assert.equal(betaText({fromStore: true, on: true}).toggle, '');
  assert.equal(betaText({fromStore: true, ahead: true}).back, false, 'no "Back to stable" install');
  assert.equal(testText({fromStore: true}).toggle, '');
});

test('every update surface that handles "from source" handles "from the Store" too', () => {
  // The class: a new place that hides updates from a source run must hide them from the Store copy as well.
  const files = ['lib/app-updates.js', 'lib/app-menu.js', 'lib/app-meta-handlers.js', 'renderer/update-text.js'];
  for (const file of files) {
    const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const source = (text.match(/\bfromSource\b|\bFROM_SOURCE\b/g) || []).length;
    const store = (text.match(/\bfromStore\b|\bFROM_STORE\b|\bSELF_UPDATE\b/g) || []).length;
    assert.ok(source > 0, `positive control: ${file} handles from source`);
    assert.ok(store > 0, `${file}: handles from source but not the Microsoft Store copy`);
  }
});

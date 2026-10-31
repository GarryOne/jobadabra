// The one-time note "installed twice" (lib/two-installs-notice.js): once, only on Windows with both copies, one action, nothing removed by the app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {APPS_SETTINGS, askInstalledTwice, noticeOptions} from '../lib/two-installs-notice.js';
import {find} from './two-installs-disk.js';

// The note: shown once, only on Windows with both copies; one action that opens Windows' own page; nothing is removed by the app.
const settingsOf = () => { const saved = {}; return {saved, settings: () => saved, saveSettings: patch => Object.assign(saved, patch)}; };
const ask = async (answer, overrides = {}) => {
  const calls = {dialog: [], opened: []}, storage = settingsOf();
  const dialog = {showMessageBox: async (...args) => { calls.dialog.push(args.at(-1)); return {response: answer}; }};
  const shell = {openExternal: url => calls.opened.push(url)};
  const result = await askInstalledTwice({dialog, shell, storage, window: null, packaged: true, self: 'exe', copies: find('both'), platform: 'win32', env: {}, ...overrides});
  return {result, calls, storage};
};

test('both installed: the note asks once; "Open Installed apps" opens Windows\' page; the answer is kept before the dialog opens', async () => {
  const first = await ask(0);
  assert.equal(first.result, 'asked');
  assert.deepEqual(first.calls.opened, [APPS_SETTINGS]);
  assert.equal(first.storage.saved.installedTwiceAsked, true);
  const again = await askInstalledTwice({dialog: {showMessageBox: () => assert.fail('asked twice')}, shell: {}, storage: {settings: () => ({installedTwiceAsked: true}), saveSettings() {}}, window: null, packaged: true, self: 'exe', copies: find('both'), platform: 'win32', env: {}});
  assert.equal(again, 'skipped');
});

test('"Keep both" opens nothing', async () => {
  const kept = await ask(1);
  assert.equal(kept.result, 'asked');
  assert.deepEqual(kept.calls.opened, []);
});

test('one copy, or not Windows, or a test/demo data folder: no note and nothing saved', async () => {
  for (const name of ['none', 'storeOnly', 'exeOnly']) { const run = await ask(0, {copies: find(name)}); assert.equal(run.result, 'skipped', name); assert.deepEqual(run.storage.saved, {}, name); }
  assert.equal((await ask(0, {platform: 'darwin'})).result, 'skipped');
  const source = await ask(0, {packaged: false});
  assert.deepEqual([source.result, source.calls.dialog.length, source.storage.saved], ['skipped', 0, {}], 'from source (npm start) nothing is asked and no flag is set in the dev folder');
  const test = await ask(0, {env: {JOB_PILOTTO_USER_DATA: '/tmp/x'}});
  assert.equal(test.result, 'skipped');
  assert.deepEqual([test.calls.dialog.length, test.storage.saved], [0, {}], 'a test or demo run never opens a dialog');
  assert.equal((await ask(0, {dialog: {showMessageBox: async () => { throw new Error('no window'); }}})).result, 'failed', 'a dialog that throws never rejects');
});

test('the note recommends the Store copy and says nothing is removed by the app, whichever copy is open', () => {
  for (const self of ['store', 'exe']) {
    const options = noticeOptions({self});
    assert.match(options.detail, /Nothing is removed unless you do it in Windows/);
    assert.deepEqual(options.buttons, ['Open Installed apps', 'Keep both']);
    assert.match(options.detail, /not from the Microsoft Store/);
  }
  assert.match(noticeOptions({self: 'exe'}).detail, /Keep the Microsoft Store one/);
});

test('the note never says the two copies share their data (a Store copy first used on a clean PC keeps its own, JOB-165)', () => {
  for (const self of ['store', 'exe']) {
    const {detail} = noticeOptions({self});
    assert.doesNotMatch(detail, /share (your|their|the) data|same data|one data folder/i, self);
    assert.match(detail, /may be kept separately in each copy/, self);
    assert.match(detail, /Removing the Microsoft Store copy can also remove data kept only in it/, self);
    assert.doesNotMatch(detail, /Removing a copy also removes/, 'the installer copy keeps %APPDATA% on uninstall (nsis has no deleteAppDataOnUninstall)');
  }
});

test('the ask-once flag round-trips through the real storage: the second start asks nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'two-installs-'));
  const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
  let asked = 0;
  const dialog = {showMessageBox: async () => { asked++; return {response: 1}; }};
  const args = {dialog, shell: {}, storage, window: null, packaged: true, self: 'exe', copies: find('both'), platform: 'win32', env: {}};
  assert.equal(await askInstalledTwice(args), 'asked');
  assert.equal(await askInstalledTwice({...args, storage: createStorage(dir, {encrypt: value => value, decrypt: value => value})}), 'skipped', 'a new storage object on the same folder, as after a restart');
  assert.equal(asked, 1);
});

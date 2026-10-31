// The one-time note "installed twice" (lib/two-installs-notice.js): once, only on Windows with both copies, one action, nothing removed by the app.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {APPS_SETTINGS, askInstalledTwice, noticeOptions} from '../lib/two-installs-notice.js';
import {detectCopies, EXE_FOLDER, STORE_IDENTITY} from '../lib/two-installs.js';

const LOCAL = 'C:\\Users\\p\\AppData\\Local';
const FAMILY = `${STORE_IDENTITY}_8wekyb3d8bbwe`;
const EXE = `${LOCAL}\\Programs\\${EXE_FOLDER}\\Jobadabra.exe`;
const probes = ({packages = [], files = []} = {}) => ({names: dir => (dir === `${LOCAL}\\Packages` ? packages : []), isFile: file => files.includes(file)});
const disk = {none: probes(), storeOnly: probes({packages: [FAMILY]}), exeOnly: probes({files: [EXE]}), both: probes({packages: [FAMILY], files: [EXE]})};
const find = name => detectCopies({env: {LOCALAPPDATA: LOCAL}, probes: disk[name]});

// The note: shown once, only on Windows with both copies; one action that opens Windows' own page; nothing is removed by the app.
const settingsOf = () => { const saved = {}; return {saved, settings: () => saved, saveSettings: patch => Object.assign(saved, patch)}; };
const ask = (answer, overrides = {}) => {
  const calls = {dialog: [], opened: []}, storage = settingsOf();
  const dialog = {showMessageBoxSync: (_, options) => { calls.dialog.push(options); return answer; }};
  const shell = {openExternal: url => calls.opened.push(url)};
  const result = askInstalledTwice({dialog, shell, storage, window: null, self: 'exe', copies: find('both'), platform: 'win32', ...overrides});
  return {result, calls, storage};
};

test('both installed: the note asks once; "Open Installed apps" opens Windows\' page; the answer is kept before the dialog opens', () => {
  const first = ask(0);
  assert.equal(first.result, 'asked');
  assert.deepEqual(first.calls.opened, [APPS_SETTINGS]);
  assert.equal(first.storage.saved.installedTwiceAsked, true);
  const again = askInstalledTwice({dialog: {showMessageBoxSync: () => assert.fail('asked twice')}, shell: {}, storage: {settings: () => ({installedTwiceAsked: true}), saveSettings() {}}, window: null, self: 'exe', copies: find('both'), platform: 'win32'});
  assert.equal(again, 'skipped');
});

test('"Keep both" opens nothing', () => {
  const kept = ask(1);
  assert.equal(kept.result, 'asked');
  assert.deepEqual(kept.calls.opened, []);
});

test('one copy, or not Windows: no note and nothing saved', () => {
  for (const name of ['none', 'storeOnly', 'exeOnly']) { const run = ask(0, {copies: find(name)}); assert.equal(run.result, 'skipped', name); assert.deepEqual(run.storage.saved, {}, name); }
  assert.equal(ask(0, {platform: 'darwin'}).result, 'skipped');
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

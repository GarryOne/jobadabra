// The browsers' own records say whether the Jobadabra extension is installed (lib/extension-install.js): instant,
// and still true with Chrome closed. The unpacked extension's ID is Chrome's own hash of its path, which is what
// lets the app open its options page without asking the browser anything.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import * as ext from '../lib/extension-install.js';

const record = (name, extra = {}) => ({manifest: {name, version: '0.8.16'}, path: '/app/extension', location: 4,
  disable_reasons: [], ...extra});
const prefs = settings => JSON.stringify({extensions: {settings}});
// A browser whose <profile>/Secure Preferences is the given JSON, and which has nothing else. The fixtures name their
// files with "/", as Chrome's own paths are written; the app builds them with path.join, which is "\" on Windows —
// so compare on the platform's own separator, or the same test means two different things on two machines.
const platforms = key => key.split('/').join(path.sep);
const fake = (files, list = () => ['Default']) => ({
  list,
  exists: at => Object.keys(files).some(key => at.endsWith(platforms(key))),
  read: at => { const key = Object.keys(files).find(k => at.endsWith(platforms(k))); if (!key) throw new Error(`no ${at}`); return files[key]; },
});

test('the Jobadabra record in a browser profile is found; other extensions are not', () => {
  const files = {
    'Default/Secure Preferences': prefs({
      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: record('Jobadabra'),
      bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: record('Gemini in Chrome', {location: 5, path: '/Chrome.app/glic'}),
    }),
    'Profile 1/Secure Preferences': prefs({cccccccccccccccccccccccccccccccc: record('Something Else')}),
  };
  const io = fake(files, () => ['Default', 'Profile 1']);
  assert.deepEqual(ext.inProfile('/support/Google/Chrome', io), [
    {id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', profile: 'Default', version: '0.8.16', folder: '/app/extension',
      enabled: true, unpacked: true},
  ]);  // the settings key IS the extension's ID: what its options page lives at
});

test('a turned-off extension is found and said to be off', () => {
  const io = fake({'Default/Secure Preferences': prefs({aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: record('Jobadabra', {disable_reasons: [1]})})});
  assert.equal(ext.inProfile('/support/Google/Chrome', io)[0].enabled, false);
});

test('older browsers keep it in Preferences, which is read too', () => {
  const io = fake({'Default/Preferences': prefs({aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: record('Jobadabra')})});
  assert.equal(ext.inProfile('/support/Chromium', io).length, 1);
});

test('every browser that has it is listed, and the copy loaded from our folder is marked current', () => {
  const io = {
    exists: at => at === platforms('/support/Google/Chrome') || at === platforms('/support/BraveSoftware/Brave-Browser')
      || at.endsWith(platforms('/Default/Secure Preferences')),
    read: at => prefs(at.includes('Brave') ? {bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: record('Jobadabra', {path: '/Users/x/Desktop/extension'})}
      : {aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: record('Jobadabra')}),
  };
  const found = ext.installed({folder: '/app/extension', support: '/support', read: io.read, exists: io.exists,
    browsers: [{name: 'Google Chrome', dir: 'Google/Chrome', app: 'Google Chrome'},
      {name: 'Brave', dir: 'BraveSoftware/Brave-Browser', app: 'Brave Browser'},
      {name: 'Vivaldi', dir: 'Vivaldi', app: 'Vivaldi'}]});
  assert.deepEqual(found.map(entry => [entry.browser, entry.current]), [['Google Chrome', true], ['Brave', false]]);
});

test('a browser is up only when the computer says its process is', async () => {
  // The Mac: pgrep, by app name.
  assert.equal(await ext.running('Google Chrome', {exec: (file, args, done) => { assert.equal(file, '/usr/bin/pgrep'); done(null, ''); }, platform: 'darwin'}), true);
  assert.equal(await ext.running('Google Chrome', {exec: (file, args, done) => done(new Error('no')), platform: 'darwin'}), false);
  assert.equal(await ext.running('Brave Browser', {exec: (file, args, done) => { assert.equal(args[0], '-x'); assert.equal(args[1], 'Brave Browser'); done(null, ''); }, platform: 'darwin'}), true);
  // Windows: tasklist, filtered by the browser's own process name; its output is what decides.
  const edge = 'Microsoft Edge';
  assert.equal(await ext.running(edge, {platform: 'win32', exec: (file, args, done) => {
    assert.equal(file, 'tasklist'); assert.deepEqual(args, ['/FI', 'IMAGENAME eq msedge.exe', '/NH']);
    done(null, 'msedge.exe   1234 Console   1   100,000 K');
  }}), true);
  assert.equal(await ext.running('Brave', {platform: 'win32', exec: (file, args, done) => done(null, 'INFO: No tasks are running which match the specified criteria.')}), false);
  assert.equal(await ext.running(edge, {platform: 'win32', exec: (file, args, done) => done(new Error('no'))}), false);
});

test('an unpacked copy is recorded by its path alone — no manifest block — and is still found', () => {
  // Chrome's record for a "Load unpacked" install: `location: 4`, the path, and no manifest at all. Matching on the
  // name alone missed exactly this, and the app told its owner to install what was already installed (1 Oct 2026).
  const unpacked = {path: '/app/extension', location: 4, disable_reasons: []};
  const io = fake({'Default/Secure Preferences': prefs({aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: unpacked})}, () => ['Default']);
  assert.deepEqual(ext.inProfile('/support/Google/Chrome', {...io, folder: '/app/extension'}), [
    {id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', profile: 'Default', version: '', folder: '/app/extension', enabled: true, unpacked: true}]);
  assert.deepEqual(ext.inProfile('/support/Google/Chrome', {...io, folder: '/somewhere/else/extension'}), []);  // not our folder
  assert.deepEqual(ext.inProfile('/support/Google/Chrome', io), []);  // nothing named it, so nothing to match on
});

test('the extension ID comes from the manifest\'s own key (stable), and from the folder path without one', () => {
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  // The key in extension/manifest.json: the ID Chrome itself recorded for this install, whatever folder it is in.
  assert.equal(ext.extensionId(path.join(repo, 'extension')), 'gpffoneapcfceflfmfgedkcfbommgcfk');
  assert.match(ext.extensionId('/tmp/somewhere/extension'), /^[a-p]{32}$/);  // no manifest there: Chrome's path hash
  assert.notEqual(ext.extensionId('/tmp/a/extension'), ext.extensionId('/tmp/b/extension'));
});

test('the two pages open in Chrome itself, on the Mac and on the PC', async () => {
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const options = 'chrome-extension://gpffoneapcfceflfmfgedkcfbommgcfk/options.html';  // the manifest key's ID
  const opened = [];
  const record = (file, args, done) => { opened.push([file, args.join(' ')]); done(null, ''); };
  // The Mac: `open -a`, which is what knows Chrome's name whatever folder it was installed into.
  const chromeApp = file => file === '/Applications/Google Chrome.app';
  assert.equal(await ext.openExtensionsPage({exec: record, platform: 'darwin', env: {HOME: '/h'}, exists: chromeApp}), true);
  assert.equal(await ext.openOptionsPage(path.join(repo, 'extension'), {exec: record, platform: 'darwin', env: {HOME: '/h'}, exists: chromeApp}), true);
  assert.deepEqual(opened, [['open', '-a Google Chrome chrome://extensions'], ['open', '-a Google Chrome ' + options]]);
  // Windows: chrome.exe itself, from where its installer puts it — no shell, so a URL's & stays in the URL.
  const chrome = path.win32.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const env = {ProgramFiles: 'C:\\Program Files'};
  opened.length = 0;
  assert.equal(await ext.openExtensionsPage({exec: record, platform: 'win32', env, exists: file => file === chrome}), true);
  assert.deepEqual(opened, [[chrome, 'chrome://extensions']]);
  // No Chrome installed: nothing to open it with, and the press says so rather than failing quietly.
  assert.equal(await ext.openExtensionsPage({exec: record, platform: 'win32', env: {}, exists: () => false}), false);
  assert.equal(opened.length, 1);
});

test('the PC\'s profiles are read too: %LOCALAPPDATA%, one folder deeper than the Mac\'s', () => {
  const local = 'C:\\Users\\x\\AppData\\Local';
  const chrome = ext.BROWSERS[0];
  const dir = path.win32.join(local, 'Google', 'Chrome', 'User Data');
  const io = {
    exists: at => at === dir || at.endsWith(path.win32.join('Default', 'Secure Preferences')),
    read: () => prefs({aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: record('Jobadabra')}),
  };
  const found = ext.installed({folder: '/app/extension', platform: 'win32', env: {LOCALAPPDATA: local}, browsers: [chrome], ...io});
  assert.deepEqual(found.map(entry => [entry.browser, entry.profile, entry.current]), [['Google Chrome', 'Default', true]]);
  // Where the default root resolves, and the folder each platform keeps the browser's profiles in. The Mac's layout
  // has no "User Data" level, and Chrome Canary is "Chrome SxS" on the PC.
  assert.equal(ext.support('win32', {LOCALAPPDATA: local}), local);
  assert.equal(ext.support('darwin'), path.join(os.homedir(), 'Library', 'Application Support'));
  assert.equal(ext.browserDir(chrome, 'win32'), 'Google/Chrome/User Data');
  assert.equal(ext.browserDir(chrome, 'darwin'), 'Google/Chrome');
  assert.equal(ext.browserDir(ext.BROWSERS[1], 'win32'), 'Google/Chrome SxS/User Data');
  // A browser with no Windows layout of its own (a test fixture, or a new entry) still gets read by its Mac folder.
  assert.equal(ext.browserDir({dir: 'Acme/Browser'}, 'win32'), 'Acme/Browser');
});

test('every browser carries both platforms\' folders and a PC process name, so a new one cannot be half-listed', () => {
  for (const browser of ext.BROWSERS) {
    assert.match(browser.win, /User Data$/, `${browser.name}: no folder under the PC's local app data`);
    assert.match(ext.PROCESS[browser.app] || '', /\.exe$/, `${browser.name}: no Windows process name`);
  }
});

test('the folders it looked in are listed, each with whether it is there', () => {
  const looked = ext.lookedFor({platform: 'win32', env: {LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local'},
    exists: at => at === 'C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\User Data'});
  assert.equal(looked.length, ext.BROWSERS.length, 'one line per browser it knows');
  assert.deepEqual(looked[0], {browser: 'Google Chrome', dir: 'Google/Chrome/User Data',
    at: 'C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\User Data', there: true});
  assert.deepEqual(looked.at(-1), {browser: 'Vivaldi', dir: 'Vivaldi/User Data',
    at: 'C:\\Users\\x\\AppData\\Local\\Vivaldi\\User Data', there: false});
});

test('on the Mac the same list sits under Application Support, with no User Data level', () => {
  const looked = ext.lookedFor({platform: 'darwin', exists: () => false});
  const base = path.join(os.homedir(), 'Library', 'Application Support');
  for (const entry of looked) assert.equal(entry.at, path.join(base, entry.dir));
  assert.equal(looked[0].at, path.join(base, 'Google/Chrome'));
});

test('Edge: its own extensions page, and forms open where the extension is', async () => {
  const opened = [];
  const record = (file, args, done) => { opened.push([file, args.join(' ')]); done(null, ''); };
  assert.equal(ext.extensionsUrl('Microsoft Edge'), 'edge://extensions');
  assert.equal(ext.extensionsUrl(''), 'chrome://extensions');
  // A PC with only Edge (the Windows default): msedge.exe, from Program Files (x86) where Edge lives.
  const edge = path.win32.join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const env = {'ProgramFiles(x86)': 'C:\\Program Files (x86)'};
  assert.equal(await ext.openExtensionsPage({exec: record, platform: 'win32', env, exists: file => file === edge, browser: 'Microsoft Edge'}), true);
  assert.deepEqual(opened, [[edge, 'edge://extensions']]);
  // No Chrome, no preference: Edge still opens it.
  opened.length = 0;
  assert.equal(await ext.openInChrome('https://x', {exec: record, platform: 'win32', env, exists: file => file === edge}), true);
  assert.deepEqual(opened, [[edge, 'https://x']]);
  // The Mac: Edge's app name.
  opened.length = 0;
  assert.equal(await ext.openInChrome('https://x', {exec: record, platform: 'darwin', exists: file => file === '/Applications/Microsoft Edge.app', browser: 'Microsoft Edge'}), true);
  assert.deepEqual(opened, [['open', '-a Microsoft Edge https://x']]);
});

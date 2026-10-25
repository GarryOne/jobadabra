// The Jobadabra rename moves an install's data folder to its new name without losing a file, and keeps the Keychain item that seals its tokens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {DATA_NAME, keepLegacyIdentity, LEGACY_NAME, migrateDataFolder, realDataFolders} from '../lib/app-identity.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'app-identity-'));
const seed = (dir, files) => { for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true}); fs.writeFileSync(path.join(dir, rel), text); } };

function fakeApp(appData) {
  const log = [];
  let ready;
  const app = {
    name: 'Jobadabra', paths: {appData},
    setName(name) { app.name = name; log.push(`name:${name}`); },
    getPath: kind => app.paths[kind], setPath(kind, value) { app.paths[kind] = value; },
    whenReady: () => new Promise(resolve => { ready = resolve; }),
  };
  return {app, log, ready: () => ready()};
}

// Upgrade proof: an install from before the rename (data under "Job Pilotto") starts the new app and finds every file at the new name.
test('a pre-rename data folder is moved to Jobadabra with every file, and the old name is gone', () => {
  const appData = tmp();
  const files = {'settings.json': '{"setupDone":true}', 'secrets.json': '{"NOTION_TOKEN":"sealed"}', 'data/jobs.sqlite': 'rows', 'cv/cv.json': '{}', 'logs/app.log': 'x'};
  seed(path.join(appData, LEGACY_NAME), files);
  const messages = [];
  assert.equal(migrateDataFolder(appData, {log: text => messages.push(text)}), path.join(appData, DATA_NAME));
  for (const [rel, text] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(appData, DATA_NAME, rel), 'utf8'), text, rel);
  assert.deepEqual(fs.readdirSync(appData), [DATA_NAME]);
  assert.equal(messages.length, 1);
});

test('a fresh install, and an install already moved, are left alone', () => {
  const fresh = tmp();
  assert.equal(migrateDataFolder(fresh), path.join(fresh, DATA_NAME));
  assert.deepEqual(fs.readdirSync(fresh), []);
  const moved = tmp();
  seed(path.join(moved, DATA_NAME), {'settings.json': 'new'});
  assert.equal(migrateDataFolder(moved), path.join(moved, DATA_NAME));
  assert.equal(fs.readFileSync(path.join(moved, DATA_NAME, 'settings.json'), 'utf8'), 'new');
});

test('both folders with data: the new one is used and nothing is touched; an empty new one is replaced', () => {
  const both = tmp();
  seed(path.join(both, LEGACY_NAME), {'settings.json': 'old'});
  seed(path.join(both, DATA_NAME), {'settings.json': 'new'});
  assert.equal(migrateDataFolder(both), path.join(both, DATA_NAME));
  assert.equal(fs.readFileSync(path.join(both, LEGACY_NAME, 'settings.json'), 'utf8'), 'old');
  const empty = tmp();
  seed(path.join(empty, LEGACY_NAME), {'settings.json': 'old'});
  fs.mkdirSync(path.join(empty, DATA_NAME));
  assert.equal(migrateDataFolder(empty), path.join(empty, DATA_NAME));
  assert.equal(fs.readFileSync(path.join(empty, DATA_NAME, 'settings.json'), 'utf8'), 'old');
});

// 8c's msix spike (25 Oct 2026): a rename inside the Store package of a folder the NSIS install made moved it into the package's private cache.
test('the Store build never moves a folder it did not create, and moves its own like any other', () => {
  const appData = tmp();
  seed(path.join(appData, LEGACY_NAME), {'settings.json': 'old'});
  assert.equal(migrateDataFolder(appData, {store: true}), path.join(appData, LEGACY_NAME));
  assert.deepEqual(fs.readdirSync(appData), [LEGACY_NAME]);
});

test('a move that fails keeps using the old folder and loses nothing', () => {
  const appData = tmp();
  seed(path.join(appData, LEGACY_NAME), {'settings.json': 'old'});
  const real = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('busy'), {code: 'EBUSY'}); };   // a file held open on Windows
  try {
    const messages = [];
    assert.equal(migrateDataFolder(appData, {log: text => messages.push(text)}), path.join(appData, LEGACY_NAME));
    assert.match(messages[0], /EBUSY/);
  } finally { fs.renameSync = real; }
  assert.equal(fs.readFileSync(path.join(appData, LEGACY_NAME, 'settings.json'), 'utf8'), 'old');
  assert.equal(migrateDataFolder(appData), path.join(appData, DATA_NAME), 'tried again at the next start');
});

test('the data folder is Jobadabra; the Keychain item is sealed under the old name, then the app shows Jobadabra', async () => {
  const appData = tmp();
  const {app, log, ready} = fakeApp(appData);
  const safeStorage = {isEncryptionAvailable: () => true, encryptString: () => { log.push(`seal under:${app.name}`); return Buffer.from('x'); }};
  keepLegacyIdentity({app, safeStorage});
  assert.equal(app.paths.userData, path.join(appData, DATA_NAME));
  assert.equal(app.name, LEGACY_NAME);
  ready(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(log, ['name:Job Pilotto', 'seal under:Job Pilotto', 'name:Jobadabra']);
});

// "Tests and automation never touch the owner's live app": a test or demo folder must stop the move.
test('with a test or demo folder the real data folder is not moved', () => {
  const appData = tmp();
  seed(path.join(appData, LEGACY_NAME), {'settings.json': 'real'});
  const {app} = fakeApp(appData);
  keepLegacyIdentity({app, safeStorage: {}, userDataOverride: '/tmp/demo'});
  assert.deepEqual(fs.readdirSync(appData), [LEGACY_NAME]);
  assert.equal(app.paths.userData, undefined, 'main.js sets the override itself');
});

test('a machine without a keychain still ends up named Jobadabra', async () => {
  const {app, ready} = fakeApp(tmp());
  keepLegacyIdentity({app, safeStorage: {isEncryptionAvailable: () => { throw new Error('no keyring'); }}});
  ready(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.name, 'Jobadabra');
});

test('every guard that protects the real folder lists both names', () => {
  assert.deepEqual(realDataFolders('/Users/a', 'darwin', {}), ['/Users/a/Library/Application Support/Jobadabra', '/Users/a/Library/Application Support/Job Pilotto']);
  assert.deepEqual(realDataFolders('C:\\Users\\a', 'win32', {APPDATA: 'C:\\Users\\a\\AppData\\Roaming'}), ['C:\\Users\\a\\AppData\\Roaming\\Jobadabra', 'C:\\Users\\a\\AppData\\Roaming\\Job Pilotto']);
});

// Electron finds its "<CFBundleName> Helper" apps by the bundle's CFBundleName; the builder names them after productName. A different CFBundleName
// (19 Oct 2026, the rename) made every packaged Mac app die at launch with "Unable to find helper app" (the nightly beta's smoke, 20 + 21 Oct).
test('the Mac bundle name is the product name the helper apps are named after', () => {
  const build = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build;
  const bundleName = build.mac.extendInfo?.CFBundleName;
  assert.ok(bundleName === undefined || bundleName === build.productName, `CFBundleName ${bundleName} must be absent or ${build.productName}: the helpers are "${build.productName} Helper"`);
});

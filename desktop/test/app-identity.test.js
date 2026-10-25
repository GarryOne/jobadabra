// The Jobadabra rename moves an install's data folder to its new name without losing a file, and keeps the Keychain item that seals its tokens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {DATA_NAME, everyRealDataFolder, keepLegacyIdentity, LEGACY_NAME, migrateDataFolder, realDataFolders, userDataTime} from '../lib/app-identity.js';

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

const REAL = {'settings.json': '{"setupDone":true}', 'data/jobs.sqlite': 'rows'};
const CHROMIUM = {'Cache/data_0': 'x', 'GPUCache/index': 'y', 'DIPS': 'z', 'Local State': '{}', 'declarative_performance_observer.db': 'w'};
// What a start of the app makes by itself in a folder that was never set up (the owner's Jobadabra folder, 25 Oct 2026).
const FRESH_START = {...CHROMIUM, 'settings.json': '{"setupFurthest":"welcome"}', 'secrets.json': '{"EXTENSION_TOKEN":"sealed"}', 'queue.json': '[]', 'data/tracker.sqlite': 'empty', 'config/search.json': '{}'};
const names = dir => fs.readdirSync(dir).sort();

// 25 Oct 2026, the owner's dev app: "Job Pilotto" held the data and "Jobadabra" held Chromium's caches, so the move took the leftover for real data and opened at the setup.
for (const [what, leftover] of [['only Chromium files', CHROMIUM], ['a never-set-up start (fresh settings, extension token, empty tracker)', FRESH_START]]) {
  for (const win of [false, true]) test(`old folder with data, new folder with ${what}${win ? ' (Windows-style names)' : ''}: the new one is set aside, never deleted, and the old data moves in`, () => {
    const appData = tmp();
    seed(path.join(appData, LEGACY_NAME), REAL);
    seed(path.join(appData, DATA_NAME), leftover);
    const messages = [];
    assert.equal(migrateDataFolder(appData, {log: text => messages.push(text), now: () => 42}), path.join(appData, DATA_NAME));
    for (const [rel, text] of Object.entries(REAL)) assert.equal(fs.readFileSync(path.join(appData, DATA_NAME, rel), 'utf8'), text, rel);
    assert.deepEqual(names(appData), ([DATA_NAME, `${DATA_NAME}.leftover-42`]).sort());
    for (const [rel, text] of Object.entries(leftover)) assert.equal(fs.readFileSync(path.join(appData, `${DATA_NAME}.leftover-42`, rel), 'utf8'), text, `kept: ${rel}`);
    assert.ok(messages.some(text => /set aside/.test(text)));
  });
}

test('the data files of storage.js each count as data in the new folder, and the files a start makes alone do not', () => {
  for (const [rel, text] of [['settings.json', '{"setupDone":true}'], ['secrets.json', '{"ANTHROPIC_API_KEY":"s"}'], ['profile.md', 'p'], ['answers.md', 'a'], ['cv.pdf', 'c'], ['cv/cv.json', '{}'], ['data/jobs.sqlite', 'r']]) {
    assert.ok(userDataTime(seeded(rel, text)) > 0, rel);
  }
  for (const [rel, text] of Object.entries(FRESH_START)) assert.equal(userDataTime(seeded(rel, text)), 0, rel);
  function seeded(rel, text) { const dir = tmp(); seed(dir, {[rel]: text}); return dir; }
});

test('only the new folder has data: it is used, the old is left alone; only the old: it moves; neither: nothing happens', () => {
  const onlyNew = tmp();
  seed(path.join(onlyNew, DATA_NAME), REAL);
  seed(path.join(onlyNew, LEGACY_NAME), CHROMIUM);
  assert.equal(migrateDataFolder(onlyNew), path.join(onlyNew, DATA_NAME));
  assert.deepEqual(names(onlyNew), ([DATA_NAME, LEGACY_NAME]).sort());
  const onlyOld = tmp();
  seed(path.join(onlyOld, LEGACY_NAME), REAL);
  assert.equal(migrateDataFolder(onlyOld), path.join(onlyOld, DATA_NAME));
  assert.deepEqual(names(onlyOld), ([DATA_NAME]).sort());
  const neither = tmp();
  seed(path.join(neither, DATA_NAME), CHROMIUM);
  seed(path.join(neither, LEGACY_NAME), CHROMIUM);
  assert.equal(migrateDataFolder(neither), path.join(neither, DATA_NAME));
  assert.deepEqual(names(neither), ([DATA_NAME, LEGACY_NAME]).sort());
});

test('both folders with data: nothing moves, the one written last is used, and the log says so', () => {
  for (const [newer, older] of [[DATA_NAME, LEGACY_NAME], [LEGACY_NAME, DATA_NAME]]) {
    const appData = tmp();
    seed(path.join(appData, older), REAL);
    seed(path.join(appData, newer), REAL);
    const past = new Date(Date.now() - 3600e3);
    for (const rel of Object.keys(REAL)) fs.utimesSync(path.join(appData, older, rel), past, past);
    const messages = [];
    assert.equal(migrateDataFolder(appData, {log: text => messages.push(text)}), path.join(appData, newer));
    assert.deepEqual(names(appData), ([DATA_NAME, LEGACY_NAME]).sort(), 'nothing moved');
    assert.match(messages[0], /^BOTH /);
  }
});

test('an empty new folder is replaced by the old data; a half-done setup in the old folder still moves', () => {
  const empty = tmp();
  seed(path.join(empty, LEGACY_NAME), {'settings.json': 'old'});
  fs.mkdirSync(path.join(empty, DATA_NAME));
  assert.equal(migrateDataFolder(empty, {now: () => 7}), path.join(empty, DATA_NAME));
  assert.equal(fs.readFileSync(path.join(empty, DATA_NAME, 'settings.json'), 'utf8'), 'old');
});

test('a crash between the two renames loses nothing: the next start only moves the old folder in', () => {
  const appData = tmp();
  seed(path.join(appData, LEGACY_NAME), REAL);
  seed(path.join(appData, DATA_NAME), CHROMIUM);
  const real = fs.renameSync;
  let calls = 0;
  fs.renameSync = (from, to) => { if (++calls === 2) throw Object.assign(new Error('killed'), {code: 'EIO'}); return real(from, to); };
  try { assert.equal(migrateDataFolder(appData, {now: () => 9}), path.join(appData, LEGACY_NAME)); } finally { fs.renameSync = real; }
  assert.deepEqual(names(appData), ([`${DATA_NAME}.leftover-9`, LEGACY_NAME]).sort());
  assert.equal(migrateDataFolder(appData, {now: () => 10}), path.join(appData, DATA_NAME));
  assert.equal(fs.readFileSync(path.join(appData, DATA_NAME, 'data/jobs.sqlite'), 'utf8'), 'rows');
  assert.deepEqual(names(appData), ([DATA_NAME, `${DATA_NAME}.leftover-9`]).sort());
});

test('the Store build never moves or sets aside anything: it uses the old folder with data, whatever the new folder holds', () => {
  for (const current of [null, CHROMIUM, FRESH_START]) {
    const appData = tmp();
    seed(path.join(appData, LEGACY_NAME), REAL);
    if (current) seed(path.join(appData, DATA_NAME), current);
    assert.equal(migrateDataFolder(appData, {store: true}), path.join(appData, LEGACY_NAME));
    assert.deepEqual(names(appData), (current ? [DATA_NAME, LEGACY_NAME] : [LEGACY_NAME]).sort());
  }
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

test('the guards that keep tests off the real folder refuse both OS styles and both names', () => {
  const folders = everyRealDataFolder('/Users/a', {APPDATA: 'C:\\Users\\a\\AppData\\Roaming'});
  assert.equal(folders.length, 4);
  assert.ok(folders.includes('/Users/a/Library/Application Support/Job Pilotto') && folders.includes('/Users/a/Library/Application Support/Jobadabra'));
});

// Electron finds its "<CFBundleName> Helper" apps by the bundle's CFBundleName; the builder names them after productName. A different CFBundleName
// (19 Oct 2026, the rename) made every packaged Mac app die at launch with "Unable to find helper app" (the nightly beta's smoke, 20 + 21 Oct).
test('the Mac bundle name is the product name the helper apps are named after', () => {
  const build = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build;
  const bundleName = build.mac.extendInfo?.CFBundleName;
  assert.ok(bundleName === undefined || bundleName === build.productName, `CFBundleName ${bundleName} must be absent or ${build.productName}: the helpers are "${build.productName} Helper"`);
});

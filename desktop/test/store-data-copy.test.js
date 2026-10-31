// A Microsoft Store user's data in the package's private cache comes to the real data folder, once, when the Store package stops hiding AppData (lib/store-data-copy.js and its helper).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {MAX_TRIES, handOff, ownPackageFolder, planCopy, privateDataFolder, quitBeforeStart, unpackedHelper} from '../lib/store-data-copy.js';
import {LOCK, MARKER, copyFolder, helperRunning, readMarker, run} from '../lib/store-data-copy-helper.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'store-copy-'));
const put = (dir, files) => { for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true}); fs.writeFileSync(path.join(dir, rel), text); } };
const tree = dir => { const out = {}; const walk = (d, prefix) => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const rel = prefix + e.name; if (e.isDirectory()) walk(path.join(d, e.name), `${rel}/`); else out[rel] = crypto.createHash('sha1').update(fs.readFileSync(path.join(d, e.name))).digest('hex'); } }; walk(dir, ''); return out; };

// What a Store user's private folder holds: their setup, jobs, sealed tokens and Chromium's key (`Local State`).
const STORE_USER = {'settings.json': '{"setupDone":true}', 'secrets.json': '{"NOTION_TOKEN":"sealed-with-the-key-in-Local-State"}', 'Local State': '{"os_crypt":{"encrypted_key":"the-old-key"}}', 'data/jobs.sqlite': 'rows', 'cv/cv.json': '{}', 'logs/app.log': 'old log'};
// What a first start of the upgraded app already made in the real folder: no data, its own Chromium files and a fresh key.
const FRESH_START = {'Local State': '{"os_crypt":{"encrypted_key":"a-new-key"}}', 'Preferences': '{}', 'settings.json': '{}', 'secrets.json': '{"EXTENSION_TOKEN":"x"}'};

test('the owner scenario: a Store user with private data upgrades; the real folder gets their jobs, settings, secrets and the key that opens them; the private copy stays', () => {
  const cache = path.join(tmp(), 'Jobadabra'), target = path.join(tmp(), 'Jobadabra');
  put(cache, STORE_USER); put(target, FRESH_START);
  const before = tree(cache);
  assert.equal(planCopy({target, cache}), 'copy');
  const result = copyFolder(cache, target);
  assert.deepEqual(result.failed, []);
  const copied = tree(target);
  for (const rel of Object.keys(STORE_USER)) assert.equal(copied[rel], before[rel], `${rel} is the Store user's file`);
  assert.equal(fs.readFileSync(path.join(target, 'Local State'), 'utf8'), STORE_USER['Local State'], 'the key that unseals secrets.json came over with it');
  assert.deepEqual(tree(cache), before, 'the private copy is untouched');
  assert.ok(!Object.keys(copied).some(name => name.endsWith('.copying')), 'no temp file is left');
});

test('plan: no private data, already copied, a real folder with data of its own, and the try limit', () => {
  const cache = path.join(tmp(), 'c'), target = path.join(tmp(), 't');
  put(cache, STORE_USER); fs.mkdirSync(target, {recursive: true});
  const time = dir => (dir === cache ? 1 : fs.existsSync(path.join(dir, 'profile.md')) ? 1 : 0);
  assert.equal(planCopy({target, cache: '', time}), 'none');
  assert.equal(planCopy({target, cache, time}), 'copy');
  put(target, {'profile.md': 'mine'});
  assert.equal(planCopy({target, cache, time}), 'both-have-data', 'never over a real folder that holds data');
  fs.rmSync(path.join(target, 'profile.md'));
  fs.writeFileSync(path.join(target, MARKER), JSON.stringify({state: 'done'}));
  assert.equal(planCopy({target, cache, time}), 'done', 'once');
  fs.writeFileSync(path.join(target, MARKER), JSON.stringify({state: 'started', tries: MAX_TRIES - 1}));
  assert.equal(planCopy({target, cache, time}), 'copy', 'a copy that did not finish is tried again, even when it already wrote some data');
  fs.writeFileSync(path.join(target, MARKER), JSON.stringify({state: 'started', tries: MAX_TRIES}));
  assert.equal(planCopy({target, cache, time}), 'gave-up', 'a copy that cannot finish never loops restarts');
});

test('the private folder is found by its data, under either name', () => {
  const store = path.join(tmp(), 'pkg');
  assert.equal(privateDataFolder(''), '');
  const wanted = path.join(store, 'LocalCache', 'Roaming', 'Job Pilotto');
  assert.equal(privateDataFolder(store, dir => (dir === wanted ? 5 : 0)), wanted);
});

test('the Store copy finds its own package folder from where it runs, whatever the package is called', () => {
  const exe = name => `C:\\Program Files\\WindowsApps\\${name}_1.2.3.0_x64__abc123def\\app\\Jobadabra.exe`;
  assert.equal(ownPackageFolder(exe('IgorMardari.Jobadabra'), path.join('L', 'x')), path.join('L', 'x', 'Packages', 'IgorMardari.Jobadabra_abc123def'));
  assert.equal(ownPackageFolder(exe('Jobadabra.Spike'), path.join('L', 'x')), path.join('L', 'x', 'Packages', 'Jobadabra.Spike_abc123def'));
  assert.equal(ownPackageFolder('C:\\Users\\a\\AppData\\Local\\Programs\\job-pilotto-desktop\\Jobadabra.exe', 'L'), '', 'the installer copy is not a package');
  assert.equal(ownPackageFolder(exe('IgorMardari.Jobadabra'), ''), '');
});

test('hand-off: a packaged Store copy with private data writes the marker, starts the helper detached and quits; nothing else does', () => {
  const cache = path.join(tmp(), 'Jobadabra'), target = path.join(tmp(), 'Jobadabra');
  put(cache, STORE_USER); put(target, FRESH_START);
  // privateDataFolder wants <package>\LocalCache\Roaming\<name>: build that layout
  const local = tmp(), exePath = 'C:\\Program Files\\WindowsApps\\Jobadabra.Spike_0.0.1.0_x64__x1znb4crzyan6\\app\\Jobadabra.exe';
  const pkg = ownPackageFolder(exePath, local), roaming = path.join(pkg, 'LocalCache', 'Roaming');
  fs.mkdirSync(roaming, {recursive: true}); fs.renameSync(cache, path.join(roaming, 'Jobadabra'));
  const spawned = [], exits = [];
  const app = {isPackaged: true, getPath: () => target, exit: code => exits.push(code)};
  const base = {app, platform: 'win32', windowsStore: true, exePath, local, spawnFn: (...args) => { spawned.push(args); return {unref() {}}; }, helper: 'H.mjs'};
  // userDataTime reads the real fs: the private folder holds settings.json {"setupDone":true}, so it counts as data on any OS
  assert.equal(handOff({...base, windowsStore: false}), false, 'not a Store copy');
  assert.equal(handOff({...base, platform: 'darwin'}), false);
  assert.equal(handOff({...base, app: {...app, isPackaged: false}}), false, 'from source');
  assert.deepEqual([spawned.length, exits.length], [0, 0]);
  assert.equal(handOff(base), true);
  assert.equal(spawned.length, 1);
  const [, args, options] = spawned[0];
  assert.equal(args[0], 'H.mjs');
  assert.equal(args[2], path.join(pkg, 'LocalCache', 'Roaming', 'Jobadabra'));
  assert.equal(args[3], target);
  assert.equal(options.detached, true);
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.deepEqual(exits, [0]);
  assert.equal(readMarker(target).state, 'started');
  assert.equal(readMarker(target).tries, 1);
});

test('the helper end to end: waits for the app to exit, copies, marks done and starts the app again', async () => {
  const cache = path.join(tmp(), 'Jobadabra'), target = path.join(tmp(), 'Jobadabra'), flag = path.join(tmp(), 'restarted.txt');
  put(cache, STORE_USER); put(target, FRESH_START);
  const app = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 700)'], {stdio: 'ignore'});
  const exited = new Promise(resolve => app.on('exit', resolve));
  const finished = run([String(app.pid), cache, target, process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(flag)}, 'up')`], {settleMs: 50});
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(!fs.existsSync(path.join(target, 'data', 'jobs.sqlite')), 'nothing is copied while the app is still running');
  await exited;
  const result = await finished;
  assert.deepEqual(result.failed, []);
  assert.equal(fs.readFileSync(path.join(target, 'data', 'jobs.sqlite'), 'utf8'), 'rows');
  assert.equal(readMarker(target).state, 'done');
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(flag) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fs.readFileSync(flag, 'utf8'), 'up', 'the app was started again');
});

test('a helper that cannot start leaves the app running with a failed marker; a helper whose app never exits copies nothing', async () => {
  const local = tmp(), exePath = 'C:\\Program Files\\WindowsApps\\Jobadabra.Spike_0.0.1.0_x64__x1znb4crzyan6\\app\\Jobadabra.exe';
  const pkg = ownPackageFolder(exePath, local), cache = path.join(pkg, 'LocalCache', 'Roaming', 'Jobadabra'), target = path.join(tmp(), 'Jobadabra');
  put(cache, STORE_USER); fs.mkdirSync(target, {recursive: true});
  const exits = [], logs = [];
  const base = {app: {isPackaged: true, getPath: () => target, exit: code => exits.push(code)}, platform: 'win32', windowsStore: true, exePath, local, helper: 'H.mjs', log: text => logs.push(text)};
  assert.equal(handOff({...base, spawnFn: () => { throw Object.assign(new Error('boom'), {code: 'ENOENT'}); }}), false);
  assert.deepEqual(exits, [], 'the app keeps running');
  assert.equal(readMarker(target).state, 'failed');
  assert.match(logs.join('\n'), /did not start \(ENOENT\)/);
  const result = await run([String(process.pid), cache, target, process.execPath], {settleMs: 0, limitMs: 300});
  assert.equal(result.skipped, true);
  assert.ok(!fs.existsSync(path.join(target, 'data', 'jobs.sqlite')), 'nothing is copied under a running app');
  assert.equal(readMarker(target).state, 'failed', 'the marker is not touched by a helper that did not copy');
});

test('a start while a helper is still copying quits without starting a second one; a dead helper\'s lock does not block', async () => {
  const local = tmp(), exePath = 'C:\\Program Files\\WindowsApps\\Jobadabra.Spike_0.0.1.0_x64__x1znb4crzyan6\\app\\Jobadabra.exe';
  const pkg = ownPackageFolder(exePath, local), cache = path.join(pkg, 'LocalCache', 'Roaming', 'Jobadabra'), target = path.join(tmp(), 'Jobadabra');
  put(cache, STORE_USER); fs.mkdirSync(target, {recursive: true});
  const spawned = [], exits = [];
  const base = {app: {isPackaged: true, getPath: () => target, exit: code => exits.push(code)}, platform: 'win32', windowsStore: true, exePath, local, helper: 'H.mjs', log: () => {}, spawnFn: (...args) => { spawned.push(args); return {unref() {}}; }};
  fs.writeFileSync(path.join(target, LOCK), String(process.pid));   // a live helper: this test process stands in for it
  assert.equal(helperRunning(target), true);
  assert.equal(handOff(base), true);
  assert.deepEqual([spawned.length, exits], [0, [0]], 'quits, starts nothing');
  assert.equal(readMarker(target).state, undefined, 'and leaves the marker alone');
  fs.writeFileSync(path.join(target, LOCK), '2147483646');   // a pid nobody has
  assert.equal(helperRunning(target), false);
  fs.writeFileSync(path.join(target, LOCK), String(process.pid));
  assert.equal(helperRunning(target, -1), false, 'a lock older than the limit is a leftover');
  fs.rmSync(path.join(target, LOCK));
  const finished = await run([String(2147483646), cache, target, process.execPath, '-e', '0'], {settleMs: 0});
  assert.deepEqual(finished.failed, []);
  assert.ok(!fs.existsSync(path.join(target, LOCK)), 'the helper releases its lock before it restarts the app');
});

test('the packaged helper path points into app.asar.unpacked, and the helper is unpacked by the build', () => {
  assert.match(unpackedHelper().replace(/\\/g, '/'), /lib\/store-data-copy-helper\.mjs$/);
  assert.equal('C:\\x\\resources\\app.asar\\lib\\h.mjs'.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), 'C:\\x\\resources\\app.asar.unpacked\\lib\\h.mjs');
  const build = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build;
  assert.ok(build.asarUnpack.includes('lib/store-data-copy-helper.mjs'));
  assert.ok(build.files.includes('lib/**'));
});

test('one start check for both quits: a move to Applications first, the Store hand-off only when nothing moved', () => {
  const calls = [];
  const app = {isPackaged: false};   // from source: handOff is a no-op, so only offerMove decides here
  assert.equal(quitBeforeStart({app, dialog: {}, offerMove: () => { calls.push('move'); return true; }, appLog: () => {}}), true);
  assert.equal(quitBeforeStart({app, dialog: {}, offerMove: () => { calls.push('nomove'); return false; }, appLog: () => {}}), false);
  assert.deepEqual(calls, ['move', 'nomove']);
});

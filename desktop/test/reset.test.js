// Settings → Your data: export, import and reset this computer's data folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import * as archive from '../lib/archive.js';
import * as reset from '../lib/reset.js';
import {createStorage} from '../lib/storage.js';
import {tar} from '../lib/tar.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
function profile() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  const dir = path.join(base, 'Jobadabra');
  const storage = createStorage(dir, fakeCrypto);
  storage.saveSettings({setupDone: true, cvName: 'CV.pdf'});
  storage.setSecret('NOTION_TOKEN', 'ntn_real');
  fs.writeFileSync(path.join(dir, 'cv.pdf'), 'PDF');
  fs.mkdirSync(path.join(dir, 'recordings'));
  fs.writeFileSync(path.join(dir, 'recordings', 'call.webm'), 'AUDIO');
  fs.mkdirSync(path.join(dir, 'Cache'));  // Chromium's: never exported
  return {base, dir, storage};
}

test('export then import on another computer: files and settings come back, keys only when asked', async () => {
  const a = profile();
  const file = path.join(a.base, 'export.tar.gz');
  await reset.exportTo(a.dir, file, {keys: {NOTION_TOKEN: 'ntn_real'}}, new Date('2026-09-28T12:00:00Z'));
  assert.ok(!fs.existsSync(path.join(a.dir, reset.KEYS_FILE)));  // the plain keys never stay in the data folder

  const b = profile();
  b.storage.saveSettings({cvName: 'other.pdf'});
  await reset.stageImport(b.dir, file);
  const done = reset.applyPending(b.dir, new Date('2026-09-28T13:00:00Z'));
  assert.equal(done.imported, true);
  assert.ok(fs.existsSync(done.backup));  // what was there is kept
  assert.equal(JSON.parse(fs.readFileSync(path.join(done.backup, 'settings.json'), 'utf8')).cvName, 'other.pdf');
  const imported = createStorage(b.dir, fakeCrypto);
  assert.equal(imported.settings().cvName, 'CV.pdf');
  assert.equal(fs.readFileSync(path.join(b.dir, 'recordings', 'call.webm'), 'utf8'), 'AUDIO');
  assert.ok(!fs.existsSync(path.join(b.dir, 'Cache')));
  assert.equal(reset.adoptKeys(imported), 1);
  assert.equal(imported.secret('NOTION_TOKEN'), 'ntn_real');
  assert.ok(!fs.existsSync(path.join(b.dir, reset.KEYS_FILE)));
});

// 8 Oct 2026: an export without keys, imported back on the same Mac, asked to connect Notion from scratch.
test('an export without keys keeps them on the computer that made it, and only there', async () => {
  const a = profile();
  a.storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'page-1'}});
  const file = path.join(a.base, 'export.tar.gz');
  await reset.exportTo(a.dir, file);
  await reset.stageImport(a.dir, file);
  assert.equal(reset.applyPending(a.dir).notionElsewhere, true);   // decided before the keys can be opened: main.js checks again
  assert.equal(createStorage(a.dir, fakeCrypto).secret('NOTION_TOKEN'), 'ntn_real');
  const b = profile();
  await reset.stageImport(b.dir, file);
  reset.applyPending(b.dir);
  const elsewhere = createStorage(b.dir, {encrypt: v => v, decrypt: () => { throw new Error('sealed elsewhere'); }});
  assert.equal(elsewhere.secret('NOTION_TOKEN'), '');   // asked again
  assert.deepEqual(elsewhere.unreadableSecrets(), ['NOTION_TOKEN']);
});

// A data folder moved to a "(backup …)" folder next to it, as an import (or a reset of an older version) leaves it.
const movedToBackup = dir => fs.writeFileSync(path.join(dir, 'reset-pending.json'), JSON.stringify({backup: true}));

test('an older export without keys takes them from this computer\'s backup of the same Profile, never another one\'s', async () => {
  const a = profile();
  a.storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'page-1'}});
  a.storage.setSecret('GITHUB_TOKEN', 'gh_real');
  const file = path.join(a.base, 'export.tar.gz');
  await reset.exportTo(a.dir, file);
  const old = path.join(a.base, 'old.tar.gz');   // as exports were made before 8 Oct 2026: no secrets.json
  const unpacked = fs.mkdtempSync(path.join(a.base, 'u-'));
  execFileSync(tar(), ['-xzf', file, '-C', unpacked]);
  fs.rmSync(path.join(unpacked, 'secrets.json'));
  execFileSync(tar(), ['-czf', old, '-C', unpacked, ...fs.readdirSync(unpacked)]);
  // Then a new workspace with its own key and Profile (backed up by the import, newer than the right one).
  movedToBackup(a.dir);
  reset.applyPending(a.dir, new Date('2026-10-06T10:00:00Z'));
  const other = createStorage(a.dir, fakeCrypto);
  other.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'page-2'}});
  other.setSecret('NOTION_TOKEN', 'ntn_other');
  await reset.stageImport(a.dir, old);
  reset.applyPending(a.dir, new Date('2026-10-08T10:00:00Z'));
  const imported = createStorage(a.dir, fakeCrypto);
  assert.equal(imported.secret('NOTION_TOKEN'), '');
  const kept = reset.adoptBackupKeys(imported);
  assert.deepEqual(kept.names.sort(), ['GITHUB_TOKEN', 'NOTION_TOKEN']);
  assert.match(path.basename(kept.from), /backup 2026-10-06/);
  assert.equal(imported.secret('NOTION_TOKEN'), 'ntn_real');
  assert.equal(reset.adoptBackupKeys(imported), null);   // nothing left to take
});

test('a backup key this computer cannot open is not adopted', async () => {
  const a = profile();
  a.storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'page-1'}});
  movedToBackup(a.dir);
  reset.applyPending(a.dir);
  const fresh = createStorage(a.dir, {encrypt: v => v, decrypt: () => { throw new Error('sealed elsewhere'); }});
  fresh.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'page-1'}});
  assert.equal(reset.adoptBackupKeys(fresh), null);
  assert.ok(!fs.existsSync(fresh.path('secrets.json')) || !JSON.parse(fs.readFileSync(fresh.path('secrets.json'), 'utf8')).NOTION_TOKEN);
});

// A data folder as an install really has it (6 Oct 2026, the owner's Mac): the user's files, Chromium's, logs and locks.
const KEPT = ['settings.json', 'secrets.json', 'runs.json', 'cv.pdf', 'cv.previous.pdf', 'profile.md', 'answers.md', 'draft.json', 'misses.json', 'sessions.json',
  'review-states.json', 'queue.json', 'cv/v2.pdf', 'cover-letter/acme.md', 'interviews/call.json', 'recordings/call.webm', 'apply-runs/run.json',
  'config/search.json', 'config/preferences.json', 'data/jobs.sqlite', 'data/places.json', 'data/reports/last-run.json'];
const DROPPED = ['Cache/data_0', 'Code Cache/js/x', 'GPUCache/x', 'GraphiteDawnCache/x', 'DawnWebGPUCache/x', 'view-cache/jobs.json',
  'recipes-cache.json', 'Local Storage/leveldb/x', 'Session Storage/x', 'IndexedDB/x', 'Network/Cookies', 'Network Persistent State', 'Local State',
  'Preferences', 'SingletonLock', 'DIPS', 'DIPS-wal', 'logs/app.log', 'bin/python3', 'data/run.lock', 'data/insights.lock'];

test('export then import brings back every file of the user, 1:1, and none of Chromium\'s, the logs or the locks', async () => {
  const a = profile();
  for (const name of [...KEPT, ...DROPPED]) {
    fs.mkdirSync(path.dirname(path.join(a.dir, name)), {recursive: true});
    fs.writeFileSync(path.join(a.dir, name), `content of ${name}`);
  }
  const file = path.join(a.base, 'export.tar.gz');
  await reset.exportTo(a.dir, file, {keys: {NOTION_TOKEN: 'ntn_real'}});
  const b = profile();
  await reset.stageImport(b.dir, file);
  reset.applyPending(b.dir);
  for (const name of KEPT) assert.equal(fs.readFileSync(path.join(b.dir, name), 'utf8'), `content of ${name}`, `${name} came back as it was`);
  for (const name of DROPPED) assert.ok(!fs.existsSync(path.join(b.dir, name)), `${name} is not exported`);
  const imported = createStorage(b.dir, fakeCrypto);
  reset.adoptKeys(imported);
  assert.equal(imported.secret('NOTION_TOKEN'), 'ntn_real');
});

test('every file the app keeps in its data folder is exported, unless it is left out on purpose', async () => {
  // The class, not one case: each top-level name main.js or lib/ reads or writes there. A new file is exported by default; one that must not
  // travel goes in reset.LEFT_OUT and in this list, with its reason.
  const ON_PURPOSE = {bin: 'rebuilt at start'};
  const here = path.dirname(fileURLToPath(import.meta.url));   // not URL.pathname: '/D:/…' on Windows
  const sources = [path.join(here, '..', 'main.js'), ...fs.readdirSync(path.join(here, '..', 'lib')).filter(f => f.endsWith('.js')).map(f => path.join(here, '..', 'lib', f))];
  const names = new Set();
  const pattern = /(?:storage\.(?:writeText|readText|path)\(|writeJson\(|readJson\(|path\.join\(storage\.dir, )'([^'/]+)'/g;
  for (const source of sources) for (const match of fs.readFileSync(source, 'utf8').matchAll(pattern)) names.add(match[1]);
  assert.ok(names.has('profile.md') && names.has('settings.json'), 'the scan finds the app\'s files');
  for (const name of names) {
    const left = reset.LEFT_OUT.some(rule => rule.test(name));
    assert.equal(left, name in ON_PURPOSE, left ? `${name} is left out of exports without a reason here` : `${name} must be exported`);
  }
});

test('a reset and then an import in the same minute both happen', async () => {
  const a = profile();
  fs.writeFileSync(path.join(a.dir, 'profile.md'), 'mine');
  const file = path.join(a.base, 'export.tar.gz');
  await reset.exportTo(a.dir, file);
  const minute = new Date('2026-10-06T18:13:10Z');
  reset.request(a.dir);
  const first = reset.applyPending(a.dir, minute);
  assert.deepEqual(first, {deleted: true});   // a reset leaves no backup folder (owner, 16 Oct 2026: export first instead)
  createStorage(a.dir, fakeCrypto).saveSettings({setupDone: false});   // the app's fresh start at the setup
  await reset.stageImport(a.dir, file);
  const second = reset.applyPending(a.dir, new Date('2026-10-06T18:13:50Z'));
  assert.equal(second.imported, true);
  assert.ok(second.backup, 'the import still keeps what it replaces');
  assert.equal(fs.readFileSync(path.join(a.dir, 'profile.md'), 'utf8'), 'mine');
});

test('a file that is not a Jobadabra export is refused and nothing changes', async () => {
  const a = profile();
  const bogus = path.join(a.base, 'bogus.tar.gz');
  fs.writeFileSync(path.join(a.base, 'x.txt'), 'x');
  const {execFileSync} = await import('node:child_process').then(m => m);
  execFileSync(tar(), ['-czf', bogus, '-C', a.base, 'x.txt']);
  await assert.rejects(() => reset.stageImport(a.dir, bogus), /not a Jobadabra export/);
  assert.equal(reset.applyPending(a.dir), null);
});

test('reset: the data folder is deleted at the next start, and no backup folder is made', async () => {
  const a = profile();
  reset.request(a.dir, new Date('2026-09-28T12:05:00Z'));
  assert.deepEqual(reset.applyPending(a.dir, new Date('2026-09-28T12:05:00Z')), {deleted: true});
  assert.ok(!fs.existsSync(a.dir));
  assert.deepEqual(fs.readdirSync(a.base).filter(name => /backup/.test(name)), [], 'nothing "(backup …)" next to it');
  assert.equal(reset.applyPending(a.dir), null);  // nothing pending: nothing happens
});

test('export first, reset, then import that file: the profile and the job-site accounts come back', async () => {
  const a = profile();
  fs.writeFileSync(path.join(a.dir, 'profile.md'), 'my profile');
  const file = path.join(a.base, 'before-reset.tar.gz');
  await reset.exportTo(a.dir, file, {accounts: {'jobs.example.com': {email: 'me@x.test', password: 'pw'}}});
  reset.request(a.dir);
  assert.deepEqual(reset.applyPending(a.dir), {deleted: true});
  createStorage(a.dir, fakeCrypto).saveSettings({setupDone: false});   // the app's fresh start at the setup
  assert.ok(!fs.existsSync(path.join(a.dir, 'profile.md')));
  await reset.stageImport(a.dir, file);
  assert.equal(reset.applyPending(a.dir).imported, true);
  assert.equal(fs.readFileSync(path.join(a.dir, 'profile.md'), 'utf8'), 'my profile');
  assert.ok(fs.existsSync(path.join(a.dir, 'accounts.json')), 'the accounts file is there for the app to put back in the Keychain at start');
});

test('Windows runs its own tar by full path, never a Git for Windows GNU tar from PATH', async () => {
  assert.equal(tar('win32', {SystemRoot: 'C:\\Windows'}), 'C:\\Windows\\System32\\tar.exe');
  assert.equal(tar('darwin'), 'tar');
});

// An export says whose it is and when, to the minute (owner, 6 Oct 2026): two exports of one day, or two people's, are told apart in Finder.
test('the export file is named after its person, their role and the time', async () => {
  const {exportName} = await import('../lib/reset.js');
  const at = new Date(2026, 9, 6, 22, 41);
  assert.equal(exportName({name: 'Igor Mardari', role: 'photographe', at}), 'Jobadabra export · Igor Mardari · photographe · 2026-10-06 22.41.tar.gz');
  assert.equal(exportName({at}), 'Jobadabra export · 2026-10-06 22.41.tar.gz');                    // nothing known yet: still a valid name
  assert.equal(exportName({name: 'A/B: "C"', role: 'x'.repeat(60), at}), `Jobadabra export · A B C · ${'x'.repeat(40)} · 2026-10-06 22.41.tar.gz`);  // no characters a file name refuses, no endless role
});

// 7 Oct 2026, Windows: the relaunch after an import moved the data folder half a second after the old app quit, while Windows still held it (EPERM), and the
// import was skipped. A locked folder is waited for; the import then happens.
test('import at start waits while Windows still holds the data folder, then applies it', async () => {
  const a = profile();
  const file = path.join(a.base, 'export.tar.gz');
  await reset.exportTo(a.dir, file);
  const b = profile();
  await reset.stageImport(b.dir, file);
  const rename = fs.renameSync;
  let refused = 0;
  fs.renameSync = (from, to) => {
    if (from === b.dir && refused < 2) { refused += 1; throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), {code: 'EPERM'}); }
    return rename(from, to);
  };
  try {
    const done = reset.applyPending(b.dir);
    assert.equal(refused, 2);   // the lock really happened
    assert.equal(done.imported, true);
    assert.equal(done.waited, 500);
    assert.ok(fs.existsSync(done.backup));
  } finally { fs.renameSync = rename; }
});

test('whenUnlocked: only a lock is retried, and only for so long', async () => {
  const failing = code => () => { throw Object.assign(new Error(code), {code}); };
  let calls = 0;
  assert.throws(() => reset.whenUnlocked(() => { calls += 1; failing('ENOENT')(); }, {every: 1}), /ENOENT/);
  assert.equal(calls, 1);   // not a lock: thrown at once
  calls = 0;
  const waited = {ms: 0};
  assert.throws(() => reset.whenUnlocked(() => { calls += 1; failing('EBUSY')(); }, {tries: 3, every: 1, waited}), /EBUSY/);
  assert.deepEqual([calls, waited.ms], [3, 2]);   // a lock that lasts is thrown after the last try
});

// 17 Oct 2026, Windows CI (run 39072072784, settings): the relaunched app could not remove its data folder for 14 s ("EPERM ... jp-e2e-xxxx") and the reset was not
// applied. The folder itself stays locked while a process has it open or as its working directory; what is in it is free. Its contents go, the empty folder stays.
const locked = (patch, work) => {
  const rm = fs.rmSync, rename = fs.renameSync;
  fs.rmSync = (target, options) => { if (patch.rm?.(target)) throw Object.assign(new Error(`EPERM: operation not permitted, rmdir '${target}'`), {code: 'EPERM'}); return rm(target, options); };
  fs.renameSync = (from, to) => { if (patch.rename?.(from)) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), {code: 'EPERM'}); return rename(from, to); };
  try { return work(); } finally { fs.rmSync = rm; fs.renameSync = rename; }
};

test('reset: a data folder that stays locked is emptied, and the reset is applied', async () => {
  const a = profile();
  reset.request(a.dir);
  const done = locked({rm: target => target === a.dir}, () => reset.applyPending(a.dir, new Date(), {tries: 2}));
  assert.equal(done.deleted, true);
  assert.equal(done.emptied, true);
  assert.deepEqual(fs.readdirSync(a.dir), [], 'the folder is there, empty: nothing of the profile, not even the reset marker, is left');
  assert.equal(reset.applyPending(a.dir), null, 'the reset is not asked again at the next start');
});

test('import: a data folder that cannot be renamed is emptied into the backup, and the import goes in', async () => {
  const a = profile();
  const file = path.join(a.base, 'export.tar.gz');
  await reset.exportTo(a.dir, file);
  const b = profile();
  fs.writeFileSync(path.join(b.dir, 'profile.md'), 'the one before');
  await reset.stageImport(b.dir, file);
  const done = locked({rename: from => from === b.dir}, () => reset.applyPending(b.dir, new Date(), {tries: 2}));
  assert.equal(done.imported, true);
  assert.equal(fs.readFileSync(path.join(done.backup, 'profile.md'), 'utf8'), 'the one before');
  assert.equal(fs.readFileSync(path.join(b.dir, 'cv.pdf'), 'utf8'), 'PDF');
  assert.ok(!fs.existsSync(path.join(b.dir, 'reset-pending.json')));
});

test('a Chromium file that stays locked is left; one of the app\'s own that stays locked is an error', async () => {
  const a = profile();
  reset.request(a.dir);
  const done = locked({rm: target => target === a.dir || path.basename(target) === 'Cache'}, () => reset.applyPending(a.dir, new Date(), {tries: 2}));
  assert.deepEqual(done.stayed, ['Cache']);
  assert.ok(!fs.existsSync(path.join(a.dir, 'cv.pdf')) && !fs.existsSync(path.join(a.dir, 'settings.json')));
  const b = profile();
  reset.request(b.dir);
  assert.throws(() => locked({rm: target => target === b.dir || path.basename(target) === 'cv.pdf'}, () => reset.applyPending(b.dir, new Date(), {tries: 2})), /EPERM/);
});

// The real thing on Windows CI: a process whose working directory is the folder (Windows then refuses to remove the folder, not its files). Elsewhere the folder is simply removed.
test('reset: a process working inside the data folder does not stop the reset', async () => {
  const a = profile();
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {cwd: a.dir, stdio: 'ignore'});
  await new Promise(resolve => setTimeout(resolve, 500));
  try {
    reset.request(a.dir);
    const done = reset.applyPending(a.dir, new Date(), {tries: 4});
    assert.equal(done.deleted, true);
    assert.ok(!fs.existsSync(a.dir) || fs.readdirSync(a.dir).length === 0, 'nothing of the profile is left');
  } finally { holder.kill(); }
});

// 24 Oct 2026 rename: exports now say "Jobadabra" in their manifest; exports made before say "Job Pilotto". Both are imported.
test('an export is written as "Jobadabra" and an old "Job Pilotto" export is still imported', async () => {
  const a = profile();
  const file = path.join(a.base, 'export.tar.gz');
  await reset.exportTo(a.dir, file);
  const b = profile();
  const manifest = await reset.stageImport(b.dir, file);
  assert.equal(manifest.app, 'Jobadabra');

  // The same export with the manifest an older app wrote.
  const old = path.join(a.base, 'old-export');
  fs.mkdirSync(old);
  await archive.unpack(file, old);
  fs.writeFileSync(path.join(old, 'manifest.json'), JSON.stringify({...manifest, app: 'Job Pilotto'}));
  const oldFile = path.join(a.base, 'old.tar.gz');
  await archive.pack(old, oldFile, {names: fs.readdirSync(old)});
  assert.equal((await reset.stageImport(b.dir, oldFile)).app, 'Job Pilotto');

  fs.writeFileSync(path.join(old, 'manifest.json'), JSON.stringify({app: 'Something else'}));
  const badFile = path.join(a.base, 'bad.tar.gz');
  await archive.pack(old, badFile, {names: fs.readdirSync(old)});
  await assert.rejects(reset.stageImport(b.dir, badFile), /not a Jobadabra export/);
});

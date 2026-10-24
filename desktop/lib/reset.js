// Settings → Your data: export, import and reset this computer's Jobadabra data (the data folder).
// The app can't replace its own data folder while it runs (Chromium keeps files open there), so import and
// reset are requested, the app restarts, and the folder is swapped at the very start of the next launch,
// before anything opens it. An import moves the current data to a backup folder first; a reset deletes it (the person exports first).
// Outside the folder, a reset touches only the Gmail sign-in (system-handlers.js disconnects it first); the Notion workspace, employer
// passwords in the Keychain and a GitHub repo stay as they are, and a reset never calls Notion (owner, 16 Oct 2026).
import fs from 'node:fs';
import path from 'node:path';
import * as archive from './archive.js';
import * as tracker from './tracker-snapshot.js';
import {writePrivate} from './private-file.js';
import {LEGACY_NAME} from './app-identity.js';

const MARKER = 'reset-pending.json';
export const KEYS_FILE = 'keys.json';  // an export's keys, in plain text (only when the user asked for them)
export const NOTION_FILE = 'notion.json';  // a Notion copy older exports could carry (no longer made, 8 Oct 2026): dropped at import
// What an export leaves out of the data folder; everything else goes in, so a file the app starts keeping is exported without anyone listing it
// (6 Oct 2026: a fixed list missed profile.md and answers.md, a user's whole profile before Notion, plus the strategy draft, the "Answer once" list
// and the Apply sessions). Left out: Chromium's own files (caches, cookies, its storage, its locks), logs, what the app rebuilds at start (bin/), and the
// files of an export or reset in progress. secrets.json goes in (8 Oct 2026: left out, an export imported back on the same Mac lost its Notion key and
// asked to connect from scratch): its keys are sealed for this computer, so they open only here; elsewhere they count as unreadable and are asked again
// (storage.js), unless keys.json (plain keys, when asked for at export) brings them.
export const LEFT_OUT = [/cache/i, /^(Dawn.*|Graphite.*|Shared Dictionary|SharedStorage.*|blob_storage|Local Storage|Session Storage|IndexedDB|WebStorage|Network|Network Persistent State|Crashpad|Preferences|Local State|Trust Tokens.*|Cookies.*|Dictionaries|Service Worker|VideoDecodeStats|shared_proto_db|databases|Partitions|DIPS.*|declarative_performance_observer\.db.*|DevToolsActivePort|Singleton.*|TransportSecurity|Origin Bound Certs|QuotaManager.*|Login Data.*|Web Data.*|Visited Links|Favicons.*|History.*|Top Sites.*|logs|bin|manifest\.json|keys\.json|accounts\.json|notion\.json|reset-pending\.json)$/];
// Inside the folders that go in: a run's lock (data/run.lock) would make the first run after an import wait for a holder that is gone.
const LEFT_OUT_INSIDE = ['*.lock'];
export const exported = dir => fs.readdirSync(dir).filter(name => !LEFT_OUT.some(rule => rule.test(name)));
const stamp = now => now.toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
// A name not taken yet: a reset and then an import in the same minute (the setup's "Import an export…") wanted the same folder, the rename
// failed and the import was skipped without a word (6 Oct 2026).
export function backupName(dir, now = new Date()) {
  let name = `${dir} (backup ${stamp(now)})`;
  for (let n = 2; fs.existsSync(name); n++) name = `${dir} (backup ${stamp(now)} ${n})`;
  return name;
}

// The export's file name: whose it is and when, so two exports (or two people's) are told apart at a glance in Finder:
// "Jobadabra export · Igor Mardari · Photographe · 2026-10-06 22.41.tar.gz". The name and role are left out when unknown; the time uses
// a dot (":" is not allowed in a macOS or Windows file name), local time like the backup folders.
export function exportName({name = '', role = '', at = new Date()} = {}) {
  const clean = text => String(text || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  const pad = n => String(n).padStart(2, '0');
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
  return ['Jobadabra export', clean(name), clean(role), when].filter(Boolean).join(' · ') + '.tar.gz';
}

// One .tar.gz file (tar is on macOS and Windows 10+): a manifest, the items, and keys.json if asked for.
// Async since 21 Oct 2026 (lib/archive.js): tar runs beside the app, which keeps answering; onProgress({done, total}), signal cancels.
export async function exportTo(dir, file, {keys = null, accounts = null, version = '', onProgress, signal} = {}, now = new Date()) {
  const extra = [];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({app: 'Jobadabra', version, exportedAt: now.toISOString(),
    keys: !!keys, accounts: !!accounts}, null, 1));
  extra.push('manifest.json');
  if (keys) { writePrivate(path.join(dir, KEYS_FILE), JSON.stringify(keys)); extra.push(KEYS_FILE); }
  if (accounts) { writePrivate(path.join(dir, 'accounts.json'), JSON.stringify(accounts)); extra.push('accounts.json'); }   // this profile's job-site accounts, plain text, only when ticked (lib/profile-accounts.js)
  // The SQLite store's records go in as one consistent copy, never the live file and its WAL (lib/tracker-snapshot.js).
  const snapshot = tracker.take(dir);
  const skip = [...LEFT_OUT_INSIDE, ...(snapshot ? tracker.LIVE_FILES : [])];
  try {
    await archive.pack(dir, file, {names: [...exported(dir), ...extra], excludes: skip, onProgress, signal});
  } finally {
    for (const name of extra) fs.rmSync(path.join(dir, name), {force: true});
    if (snapshot) fs.rmSync(path.join(dir, snapshot), {force: true});
  }
  return file;
}

// Import: unpack next to the data folder and check it's a Jobadabra export; the swap happens at the next start.
export async function stageImport(dir, file, {onProgress, signal} = {}) {
  const staged = `${dir} (import)`;
  fs.rmSync(staged, {recursive: true, force: true});
  fs.mkdirSync(staged, {recursive: true});
  try { await archive.unpack(file, staged, {onProgress, signal}); } catch (error) { fs.rmSync(staged, {recursive: true, force: true}); throw error; }
  tracker.restore(staged);
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(staged, 'manifest.json'), 'utf8')); } catch {}
  if (![LEGACY_NAME, 'Jobadabra'].includes(manifest?.app) || !fs.existsSync(path.join(staged, 'settings.json'))) {
    fs.rmSync(staged, {recursive: true, force: true});
    throw new Error('This file is not a Jobadabra export');
  }
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({backup: true, import: staged}));
  return manifest;
}

// A reset deletes the folder, no backup folder (owner, 16 Oct 2026): the person exports first (Settings → Your data), and imports that file to come back.
export function request(dir, now = new Date()) {
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({backup: false, at: now.toISOString()}));
}

// Windows keeps a folder locked for a moment after the process that had files open in it exits: the relaunch after "Import an export…" tried to
// move the data folder half a second after the old app quit and got EPERM, so the import was not applied (7 Oct 2026, the Windows settings suite).
// Those errors are retried for a few seconds; any other error, or one that lasts, is thrown as before. waited: the milliseconds it took (for the log).
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function whenUnlocked(work, {tries = 40, every = 250, waited = {ms: 0}} = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return work(); } catch (error) {
      if (!LOCKED.has(error.code) || attempt >= tries) throw error;
      pause(every);
      waited.ms += every;
    }
  }
}

// The folder itself cannot be removed or renamed for good (17 Oct 2026, Windows CI: "EPERM ... jp-e2e-xxxx" for 14 s, the reset not applied): a process still has the
// folder open or as its working directory, which Windows allows for the folder but not for its files. What is in it goes one by one, to `backup` (a folder made here) or
// out of the world, and the empty folder stays, which the app fills again like a new one. A Chromium file that stays locked (LEFT_OUT: caches, its storage) is left; one of
// the app's own that stays locked is an error as before, and the person is told (data.js "Import or reset did not finish").
function emptyFolder(dir, backup, waited, done, tries) {
  const unlocked = work => whenUnlocked(work, {tries: Math.min(tries, 8), waited});
  if (backup) fs.mkdirSync(backup, {recursive: true});
  const stayed = [];
  for (const name of fs.readdirSync(dir)) {
    try { unlocked(() => (backup ? fs.renameSync(path.join(dir, name), path.join(backup, name)) : fs.rmSync(path.join(dir, name), {recursive: true, force: true}))); }
    catch (error) { if (!LOCKED.has(error.code) || !LEFT_OUT.some(rule => rule.test(name))) throw error; stayed.push(name); }
  }
  if (stayed.length) done.stayed = stayed;
  done.emptied = true;
}
// An import into a folder that already exists: each of its entries moves in (the export holds only the app's own files, never Chromium's).
function moveInto(from, dir, unlocked) {
  for (const name of fs.readdirSync(from)) unlocked(() => fs.renameSync(path.join(from, name), path.join(dir, name)));
  fs.rmSync(from, {recursive: true, force: true});
}

// At start-up -> null (nothing pending), or {backup: <folder>} / {deleted: true}, plus {imported: true} / {waited: ms on a locked folder}.
export function applyPending(dir, now = new Date(), {tries = 40} = {}) {
  const marker = path.join(dir, MARKER);
  if (!fs.existsSync(marker)) return null;
  let wanted = {backup: true};
  try { wanted = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch {}
  const done = {}, waited = {ms: 0}, unlocked = work => whenUnlocked(work, {waited, tries});
  if (wanted.backup !== false) {
    done.backup = backupName(dir, now);
    try { unlocked(() => fs.renameSync(dir, done.backup)); } catch (error) { if (!LOCKED.has(error.code)) throw error; emptyFolder(dir, done.backup, waited, done, tries); }
    fs.rmSync(path.join(done.backup, MARKER), {force: true});
  } else {
    try { unlocked(() => fs.rmSync(dir, {recursive: true, force: true})); } catch (error) { if (!LOCKED.has(error.code)) throw error; emptyFolder(dir, '', waited, done, tries); }
    done.deleted = true;
  }
  if (wanted.import && fs.existsSync(wanted.import)) {
    if (fs.existsSync(dir)) moveInto(wanted.import, dir, unlocked);   // the folder itself stayed (a lock on it, see emptyFolder): the import goes in beside what stayed
    else unlocked(() => fs.renameSync(wanted.import, dir));
    fs.rmSync(path.join(dir, 'manifest.json'), {force: true});
    fs.rmSync(path.join(dir, NOTION_FILE), {force: true});  // a copy for the user to keep; Notion stays the truth
    done.imported = true;
    if (notionLeftBehind(dir)) done.notionElsewhere = true;
  }
  if (waited.ms) done.waited = waited.ms;
  return done;
}

// An import whose Profile and tracking live in a Notion workspace it brings no key for: only connecting that same workspace gets them back; a new one
// starts with the blank template (7 Oct 2026: an import, then a new workspace, left the Profile empty and every job scored 2-5). True when the
// imported settings name a Profile page and neither a Notion key (keys.json, asked for at export) nor a Profile kept on this Mac came with it.
export function notionLeftBehind(dir) {
  const read = name => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return ''; } };
  let settings = {}, keys = {};
  try { settings = JSON.parse(read('settings.json') || '{}'); } catch {}
  try { keys = JSON.parse(read(KEYS_FILE) || '{}'); } catch {}
  return !!settings.notionIds?.NOTION_PROFILE_PAGE_ID && !keys.NOTION_TOKEN && !read('profile.md').trim();
}

// After an import of an export made before 8 Oct 2026 (no secrets.json in it), on the computer that made it: a backup folder next to the data folder holds that profile's keys, sealed
// for this computer (8 Oct 2026: an export without keys, imported back on the same Mac, asked to connect Notion from scratch while the backup of the
// same Profile still had its Notion key). The newest backup whose settings name the same Profile page gives every key the import lacks; one this
// computer cannot open is dropped again, so it is asked for as before. -> {from: <backup folder>, names: [...]}, or null.
export function adoptBackupKeys(storage) {
  const profile = storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID;
  if (!profile) return null;
  const parent = path.dirname(storage.dir), prefix = `${path.basename(storage.dir)} (backup `;
  const read = (dir, name) => { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return {}; } };
  const backups = fs.readdirSync(parent).filter(name => name.startsWith(prefix)).sort().reverse().map(name => path.join(parent, name));
  const from = backups.find(dir => read(dir, 'settings.json').notionIds?.NOTION_PROFILE_PAGE_ID === profile && Object.keys(read(dir, 'secrets.json')).length);
  if (!from) return null;
  const sealed = read(from, 'secrets.json'), mine = read(storage.dir, 'secrets.json');
  const wanted = Object.keys(sealed).filter(name => !mine[name]);
  if (!wanted.length) return null;
  writePrivate(storage.path('secrets.json'), JSON.stringify({...mine, ...Object.fromEntries(wanted.map(name => [name, sealed[name]]))}, null, 2) + '\n');
  const names = wanted.filter(name => storage.secret(name) || (storage.setSecret(name, ''), false));
  return names.length ? {from, names} : null;
}

// After an import: keys that came in plain text are stored encrypted, and the plain file is deleted.
export function adoptKeys(storage) {
  const file = path.join(storage.dir, KEYS_FILE);
  if (!fs.existsSync(file)) return 0;
  let keys = {};
  try { keys = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let adopted = 0;
  for (const [name, value] of Object.entries(keys)) {
    try { if (value) { storage.setSecret(name, value); adopted += 1; } } catch {}
  }
  fs.rmSync(file, {force: true});
  return adopted;
}

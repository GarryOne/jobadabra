// Job-site accounts belong to one profile (owner, 16 Oct 2026): the profile's id, moving an old-name account to it, and what export, import and reset do with them.
// Items: jobadabra.profile-<id>.<host>.password (comment "email=… job=…"); test accounts (jobadabra.test-account.*) are outside profiles, never moved, exported or reset.
// Secrets are read and written only through lib/keychain.js (a test run or the twin never reaches the real Keychain); nothing here logs a value.
// Guards: desktop/test/profile-accounts.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as keychain from './keychain.js';
import * as credentials from './credentials.js';
import {appProfileTexts, personalValues} from './owner-values.js';

export const ACCOUNTS_FILE = 'accounts.json';   // an export's accounts, in plain text (only when the person ticked it)
const ACCOUNT = 'jobadabra';

// The profile's id: made once, kept in the settings (so an export carries it and a reset starts a new one).
export function profileId(storage) {
  let id = storage.settings().profileId;
  if (!/^profile-[0-9a-f]{12}$/.test(String(id || ''))) { id = `profile-${crypto.randomBytes(6).toString('hex')}`; storage.saveSettings({profileId: id}); }
  return id;
}

const noteOf = (service, opts) => keychain.comment(service, {account: ACCOUNT, ...opts});
const noteText = ({email, job}) => [email && `email=${email}`, job && `job=${job}`].filter(Boolean).join(' ');

// Moves one old-name account (host) to the current profile: written under the new name, read back, and only an equal read deletes the old item.
// -> 'moved' | 'kept' (the new item already has another password: both stay) | 'failed' (nothing deleted).
export function assign(host, id = credentials.currentProfile(), opts = {}) {
  if (!id || !/^[a-z0-9.-]{1,253}$/i.test(String(host || '')) || !String(host).includes('.')) return 'failed';
  const from = `jobadabra.${host}.password`, to = credentials.serviceOf(host, id);
  const secret = keychain.read(from, {account: ACCOUNT, ...opts});
  if (!secret) return 'failed';
  const there = keychain.read(to, {account: ACCOUNT, ...opts});
  if (there && there !== secret) return 'kept';
  if (!there && !keychain.write(to, secret, {account: ACCOUNT, comment: noteOf(from, opts), label: `Jobadabra: ${host}`, ...opts})) return 'failed';
  if (keychain.read(to, {account: ACCOUNT, ...opts}) !== secret) return 'failed';
  keychain.remove(from, {account: ACCOUNT, ...opts});
  return 'moved';
}

// At start (any user, idempotent): the old-name accounts whose recorded e-mail is one of this profile's move to it. The rest stay listed as unassigned; nothing is deleted.
// emails: this profile's addresses (lowercase). -> {moved, kept, left} counts, never a value.
export function migrate(emails, id = credentials.currentProfile(), opts = {}) {
  const mine = new Set([...emails].map(email => String(email).toLowerCase()));
  const text = keychain.dump(opts);
  const done = {moved: 0, kept: 0, left: 0};
  if (text === null || !id) return done;
  for (const row of credentials.parseDump(text, {profile: id}).filter(row => row.unassigned)) {
    if (!row.email || !mine.has(row.email.toLowerCase())) { done.left += 1; continue; }
    const result = assign(row.host, id, opts);
    if (result === 'moved') done.moved += 1; else if (result === 'kept') done.kept += 1; else done.left += 1;
  }
  return done;
}

// This profile's accounts for an export: {host: {password, email, job}} (plain text: the caller writes it only when the person ticked it).
export function exportable(id = credentials.currentProfile(), opts = {}) {
  const text = keychain.dump(opts), out = {};
  if (text === null || !id) return out;
  for (const row of credentials.parseDump(text, {profile: id}).filter(row => !row.test && !row.unassigned)) {
    const password = keychain.read(credentials.serviceOf(row.host, id), {account: ACCOUNT, ...opts});
    if (password) out[row.host] = {password, email: row.email, job: row.job};
  }
  return out;
}

// After an import: the accounts that came in plain text go to the Keychain under THIS (the imported) profile's id, and the plain file is deleted.
export function adopt(dir, id, opts = {}) {
  const file = path.join(dir, ACCOUNTS_FILE);
  if (!fs.existsSync(file)) return 0;
  let accounts = {}, adopted = 0;
  try { accounts = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  for (const [host, item] of Object.entries(accounts)) {
    if (!id || !/^[a-z0-9.-]{1,253}$/i.test(host) || !host.includes('.') || !item?.password) continue;
    if (keychain.write(credentials.serviceOf(host, id), String(item.password), {account: ACCOUNT, comment: noteText(item), label: `Jobadabra: ${host}`, ...opts})) adopted += 1;
  }
  fs.rmSync(file, {force: true});
  return adopted;
}

// Reset: this profile's accounts always go (16 Oct 2026; an export made with accounts ticked brings them back at its import).
// Only this profile's, never other profiles' or the test accounts. -> how many were removed.
export function onReset(id, opts = {}) { return removeAll(id, opts); }

// Removes this profile's accounts only; other profiles' and the test accounts stay. -> how many were removed.
export function removeAll(id = credentials.currentProfile(), opts = {}) {
  const text = keychain.dump(opts);
  if (text === null || !id) return 0;
  let removed = 0;
  for (const row of credentials.parseDump(text, {profile: id}).filter(row => !row.test && !row.unassigned)) {
    if (keychain.remove(credentials.serviceOf(row.host, id), {account: ACCOUNT, ...opts})) removed += 1;
  }
  return removed;
}

// At start: the profile's id into the Credentials code, its imported accounts into the Keychain, and the old-name accounts whose e-mail is this profile's moved to it
// (the e-mails it holds: its Profile, answers and contact files, and the sites it recorded an account for). -> {moved, kept, left} or null (demo).
export function start(storage, {demo = false} = {}) {
  const id = profileId(storage);
  credentials.useProfile(id);
  if (demo) return null;
  adopt(storage.dir, id);
  const emails = new Set([...personalValues(appProfileTexts([storage.dir]))].filter(([, kind]) => kind === 'email').map(([value]) => value));
  for (const item of Object.values(storage.settings().siteAccounts || {})) if (item?.email) emails.add(String(item.email).toLowerCase());
  return migrate(emails, id);
}

// Settings → Credentials: the accounts Claude made on job sites (src/ai/passwords.py: Keychain item jobadabra.<site>.password,
// with "email=… job=…" as its comment). The list comes from the Keychain's item attributes, never its secrets; a password is read
// only when you press Show or Copy. Mac only: Windows' Credential Manager is read by the engine.
import {execFileSync} from 'node:child_process';
import * as keychain from './keychain.js';   // a test run or a twin never reaches the real Keychain the same way

const ITEM = /^jobadabra\.(.+)\.password$/;
// A PROFILE'S ACCOUNT (owner, 16 Oct 2026): jobadabra.profile-<12 hex>.<host>.password belongs to that profile only (lib/profile-accounts.js). An item
// without the profile id is from before: listed apart as "unassigned" and never filled until the person (or the e-mail match at start) assigns it.
export const SCOPED = /^jobadabra\.(profile-[0-9a-f]{12})\.(.+)\.password$/;
export const UNASSIGNED = 'unassigned:';
let profile = null;   // the current profile's id, set once at start (main.js); none: names as before (tools, tests of the old shape)
export const useProfile = id => { profile = /^profile-[0-9a-f]{12}$/.test(String(id || '')) ? id : null; };
export const currentProfile = () => profile;
// The Keychain item a row's key names: a test account's, an unassigned (old-name) one, or the current profile's.
export function serviceOf(key, id = profile) {
  key = String(key || '');
  if (key.startsWith(UNASSIGNED)) return `jobadabra.${key.slice(UNASSIGNED.length)}.password`;
  return key.startsWith(TEST_PREFIX) || !id ? `jobadabra.${key}.password` : `jobadabra.${id}.${key}.password`;
}
const validKey = key => /^[a-z0-9.-]{1,253}$/i.test(String(key || '').replace(UNASSIGNED, ''));
// A TEST ACCOUNT (owner, 15 Oct 2026; docs/rules/applying.md "Signing in"): an account the owner made by hand for the tests, item jobadabra.test-account.<host>.password.
// Listed beside the real ones with test: true; its key (test-account.<host>) is what Show/Copy/Delete name. Only tests read it, never an application (forExtension refuses it).
export const TEST_PREFIX = 'test-account.';

// `security dump-keychain` (attributes only) → [{host, email, job, created}], newest first. The job-site password itself
// (jobadabra.sites.password) is not a site.
// Why (rename to Jobadabra, 1 Nov 2026, owner: "small fallbacks"): items made before the rename (job-pilotto.* with account job-pilotto) are listed too, under their new
// name; when both exist for a site the newer one is the row. Removed 2 stable releases after the rename.
const older = name => name.replace(/^job-pilotto\./, 'jobadabra.');
export function parseDump(text, {profile: id = profile} = {}) {
  const rows = [];
  for (const block of String(text || '').split(/^keychain: /m)) {
    if (!/^class: "genp"/m.test(block)) continue;
    const attr = name => (block.match(new RegExp(`"${name}"<[a-z]+>="([^"]*)"`)) || [])[1] || '';
    const svce = older(attr('svce')), scoped = svce.match(SCOPED);
    if (scoped && (!id || scoped[1] !== id)) continue;   // another profile's account: not this profile's to list
    const key = scoped ? scoped[2] : (svce.match(ITEM) || [])[1], test = !!key && !scoped && key.startsWith(TEST_PREFIX), host = test ? key.slice(TEST_PREFIX.length) : key;
    if (!host || !host.includes('.') || !['jobadabra', 'job-pilotto'].includes(attr('acct'))) continue;   // a site's host name: not 'sites' (the shared one) nor 'mac-sign'
    const unassigned = !!id && !scoped && !test;
    const note = attr('icmt'), stamp = (block.match(/"cdat"<timedate>=0x[0-9A-F]+\s+"(\d{14})Z/) || [])[1] || '';
    rows.push({host, ...(test ? {test: true, key} : {}), ...(unassigned ? {unassigned: true, key: UNASSIGNED + host} : {}), email: (note.match(/(?:^|\s)email=(\S+)/) || [])[1] || '', job: (note.match(/(?:^|\s)job=(\S+)/) || [])[1] || '',
      created: stamp ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z` : ''});
  }
  const seen = new Set();
  return rows.sort((a, b) => b.created.localeCompare(a.created)).filter(row => { const k = row.key || row.host; return seen.has(k) ? false : (seen.add(k), true); });
}

export function list(platform = process.platform, exec = execFileSync) {   // unassigned rows are marked; the Settings page draws them apart
  if (platform !== 'darwin' && !keychain.isolated()) return {ok: false, rows: [], error: 'Credentials are listed on a Mac only for now.'};
  const text = keychain.dump({exec, platform});
  return text === null ? {ok: false, rows: [], error: 'The Keychain could not be read.'} : {ok: true, rows: parseDump(text).map(row => withTestEmail(row, platform, exec))};
}

// A test account keeps its email in a sibling item (jobadabra.test-account.<host>.email, the address as its value, no comment on the password item): shown on its row so a
// test account never reads "email not recorded" (owner, 16 Oct 2026). Test rows only; a real account's row is never given an address from anywhere but its own comment.
function withTestEmail(row, platform, exec) {
  if (!row.test || row.email) return row;
  let email = '';
  try { email = keychain.read(`jobadabra.${row.key}.email`, {account: 'jobadabra', exec, platform}) || ''; } catch { /* no email item: the row says so */ }
  return {...row, email};
}

// One site's password, when you ask for it. host comes from the list: only a plain host name is read.
export function reveal(host, platform = process.platform, exec = execFileSync) {
  if (!validKey(host)) return null;
  return keychain.read(serviceOf(host), {account: 'jobadabra', exec, platform});
}

// The owner's choice (8 Oct 2026): the extension fills a sign-in or sign-up page's password boxes from the Keychain, as a
// browser's password manager would, in a tab the app opened. Given only while an application is open, and only a site's own
// item (a plain host name with a dot). host: from Chrome's tab address, not from the page.
export function forExtension(host, {applying = false, read = reveal} = {}) {
  if (!applying || !/^[a-z0-9.-]{1,253}$/i.test(String(host || '')) || !String(host).includes('.') || String(host).startsWith(TEST_PREFIX)) return {ok: false};
  const password = read(host);
  return password ? {ok: true, password} : {ok: false};
}

// The email recorded on one site's password item (its comment "email=… job=…", set when an account was made for it), or '' (no item, or none recorded). Attributes only, never the secret.
export function emailOf(host, platform = process.platform, exec = execFileSync) {
  if (!validKey(host)) return '';
  const note = keychain.comment(serviceOf(host), {account: 'jobadabra', exec, platform});
  return (note.match(/(?:^|\s)email=(\S+)/) || [])[1] || '';
}

// Deletes one site's password item (Settings → Credentials → Delete). The account on the site stays; only this Mac forgets its password.
export function forget(host, platform = process.platform, exec = execFileSync) {
  if (!validKey(host) || !String(host).includes('.')) return false;
  return keychain.remove(serviceOf(host), {account: 'jobadabra', exec, platform});
}

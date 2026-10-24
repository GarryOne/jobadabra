// Every Keychain read of the app goes through here, and what a test or a live-test twin may reach (8 Oct 2026: a local e2e run that reached
// an account page overwrote the owner's real job-site password, job-pilotto.sites.password, because the engine's reads were isolated and its
// writes were not). The rule, shared with src/secret_store.py:
//   - a user's app: this Mac's Keychain;
//   - the end-to-end journey (JOB_PILOTTO_E2E): never the Keychain; a file in the run's own folder (JOB_PILOTTO_USER_DATA/isolated-secrets.json,
//     JOB_PILOTTO_ISOLATED_SECRETS for the engine) holds what the run itself saved;
//   - a live-test twin (JOB_PILOTTO_TWIN, docs/live-test.md): writes to its own file too; it READS that file first, then the real Keychain for the
//     job-site passwords only (job-pilotto.sites.password, job-pilotto.<host>.password), so it signs in like the real app. Nothing else of the owner's.
// Guards: desktop/test/keychain.test.js (an isolated run never calls `security`), tests/test_secret_store.py.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {writePrivate} from './private-file.js';

export const isolated = (env = process.env) => !!(env.JOB_PILOTTO_E2E || env.JOB_PILOTTO_TWIN);
// The run's own secrets file, or null (a user's app; or an isolated run without its own folder, which then reads and keeps nothing).
export const isolatedFile = (env = process.env) => (isolated(env) && env.JOB_PILOTTO_USER_DATA ? path.join(path.resolve(env.JOB_PILOTTO_USER_DATA), 'isolated-secrets.json') : null);
const SITE_PASSWORD = /^job-pilotto\.[a-z0-9.-]+\.password$/i;
// The twin may also read the Ready to send owner secret (owner, 17 Oct 2026: "Let the twin read that one item"): it is the same install, so its Send tonight / Run now reach the site as the owner's; read-only, never written.
export const TWIN_OWNER_SECRET = 'job-pilotto.ready.owner_secret';
export const twinMayRead = service => (SITE_PASSWORD.test(String(service)) && service !== 'job-pilotto.mac-sign.password') || service === TWIN_OWNER_SECRET;

// {service: {value, account, comment, created}} as the run saved them.
export function isolatedItems(env = process.env) {
  const file = isolatedFile(env);
  if (!file) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

// 24 Oct 2026: a test wrote the owner's real Keychain (Python side, src/secret_store.py). Under `node --test` the genuine execFileSync never changes it: a test passes a spy.
const refuseRealChange = (exec, env) => { if (exec === execFileSync && (env.NODE_TEST_CONTEXT || env.JOB_PILOTTO_UNDER_TEST)) throw new Error('A test tried to change the real Keychain: pass a fake exec or run isolated'); };
const real = (exec, args) => { try { return exec('security', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024}); } catch { return null; } };

// One item's secret, or null. account: the item's -a (omitted: any account, as `security` matches).
export function read(service, {account, env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  if (isolated(env)) {
    const item = isolatedItems(env)[service];
    if (item) return item.value || null;
    if (!(env.JOB_PILOTTO_TWIN && twinMayRead(service))) return null;
  }
  if (platform !== 'darwin') return null;
  return String(real(exec, ['find-generic-password', ...(account ? ['-a', account] : []), '-s', service, '-w']) || '').trim() || null;
}

// One item's comment ("email=… job=…"), never its secret; '' when there is none.
export function comment(service, {account, env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  if (isolated(env)) {
    const item = isolatedItems(env)[service];
    if (item) return item.comment || '';
    if (!(env.JOB_PILOTTO_TWIN && twinMayRead(service))) return '';
  }
  if (platform !== 'darwin') return '';
  return (String(real(exec, ['find-generic-password', ...(account ? ['-a', account] : []), '-s', service]) || '').match(/"icmt"<blob>="([^"]*)"/) || [])[1] || '';
}

// The Keychain's item attributes as `security dump-keychain` prints them (never a secret), or null when it can't be read. An isolated run gets its own
// items in the same shape (the twin also the real site-password items, as the twin reads those).
export function dump({env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  const own = Object.entries(isolatedItems(env)).map(([service, item]) => {
    const stamp = String(item.created || '').replace(/[^0-9]/g, '').slice(0, 14).padEnd(14, '0');
    return `keychain: "isolated"\nclass: "genp"\nattributes:\n    0x00000007 <blob>="${service}"\n    "acct"<blob>="${item.account || ''}"\n` +
      `    "cdat"<timedate>=0x00 "${stamp}Z\\000"\n    "icmt"<blob>="${item.comment || ''}"\n    "svce"<blob>="${service}"\n`;
  }).join('');
  if (isolated(env) && !env.JOB_PILOTTO_TWIN) return own;
  if (platform !== 'darwin') return isolated(env) ? own : null;
  const text = real(exec, ['dump-keychain']);
  if (text === null) return isolated(env) ? own : null;
  if (!isolated(env)) return text;
  const names = new Set(Object.keys(isolatedItems(env)));   // the twin: its own items, then the real site passwords it did not replace
  const kept = String(text).split(/^(?=keychain: )/m).filter(block => {
    const service = (block.match(/"svce"<blob>="([^"]*)"/) || [])[1] || '';
    return twinMayRead(service) && !names.has(service);
  });
  return own + kept.join('');
}

// Deletes one item (Settings → Credentials, owner 9 Oct 2026). A test run or the twin deletes only from its own file, never a real Keychain item. -> true when it was there.
export function remove(service, {account, env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  if (isolated(env)) {
    const items = isolatedItems(env), file = isolatedFile(env);
    if (!file || !(service in items)) return false;
    delete items[service];
    writePrivate(file, JSON.stringify(items, null, 2));
    return true;
  }
  if (platform !== 'darwin') return false;
  refuseRealChange(exec, env);
  return real(exec, ['delete-generic-password', ...(account ? ['-a', account] : []), '-s', service]) !== null;
}

// Writes one item (the app moves an account to its profile, Settings → Credentials, 16 Oct 2026). Same isolation as every other call: a test run or the twin
// writes only its own file, never the real Keychain. comment: the "email=… job=…" note. -> true when it was stored.
export function write(service, value, {account, comment = '', label = '', env = process.env, exec = execFileSync, platform = process.platform} = {}) {
  if (isolated(env)) {
    const file = isolatedFile(env);
    if (!file) return false;
    const items = isolatedItems(env), now = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    items[service] = {value, account: account || '', comment, created: items[service]?.created || now};
    writePrivate(file, JSON.stringify(items, null, 2));
    return true;
  }
  if (platform !== 'darwin' || !value) return false;
  refuseRealChange(exec, env);
  return real(exec, ['add-generic-password', '-U', '-a', account || 'job-pilotto', '-s', service, ...(label ? ['-l', label] : []), ...(comment ? ['-j', comment] : []), '-w', value]) !== null;
}

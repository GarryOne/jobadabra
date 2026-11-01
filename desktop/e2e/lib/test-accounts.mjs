// Test accounts a live pool row may sign in with (docs/rules/applying.md "Signing in", owner 13 Oct 2026): only hosts listed in the Keychain
// (job-pilotto.test-account.<host>.email / .password) on a Mac, or in the POOL_TEST_ACCOUNTS secret ({"<host>": {"email", "password"}}) on CI. Never a person's
// own data. They go into the TEST app's own secrets file (never the Keychain: lib/keychain.js), where the product's saved-password sign-in finds them.
// Guard: e2e/test/filling/test-accounts.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writePrivate} from '../../lib/private-file.js';
import {parseDump} from '../../lib/credentials.js';

// The hosts of the listed test accounts (attributes only: `security dump-keychain`, no -d; the harness is not the isolated app, so it asks the real Keychain).
export const testHosts = (exec = execFileSync) => parseDump(exec('security', ['dump-keychain'], {encoding: 'utf8', maxBuffer: 64 << 20})).filter(row => row.test).map(row => row.host);

const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

// -> {host: {email, password}}: the CI secret's JSON (JP_TEST_ACCOUNTS), else the Keychain items of the hosts JP_TEST_ACCOUNT_HOSTS names, else (a Mac) every
// item the Credentials screen lists as a test account. Only job-pilotto.test-account.* items are ever read: a real account's item is never asked for. Values never printed.
export function testAccounts(env = process.env, {keychain = (service) => execFileSync('security', ['find-generic-password', '-s', service, '-w'], {encoding: 'utf8'}).trim(), hosts = () => { try { return process.platform === 'darwin' ? testHosts() : []; } catch { return []; } }} = {}) {
  let accounts = {};
  if (env.JP_TEST_ACCOUNTS) { try { accounts = JSON.parse(env.JP_TEST_ACCOUNTS) || {}; } catch { accounts = {}; } }
  else for (const host of env.JP_TEST_ACCOUNT_HOSTS === undefined ? hosts() : String(env.JP_TEST_ACCOUNT_HOSTS).split(',').map(one => one.trim()).filter(Boolean)) {
    try { accounts[host] = {email: keychain(`job-pilotto.test-account.${host}.email`), password: keychain(`job-pilotto.test-account.${host}.password`)}; } catch { /* not listed: no sign-in there */ }
  }
  return Object.fromEntries(Object.entries(accounts).filter(([host, one]) => HOST.test(host) && one?.email && one?.password));
}

// Writes each account into the test app's secrets file as the product saves a site password (the item's comment carries the email). -> the hosts seeded.
export function seedTestAccounts(profileDir, accounts) {
  const file = path.join(profileDir, 'isolated-secrets.json');
  let items = {}; try { items = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* the first item */ }
  for (const [host, {email, password}] of Object.entries(accounts)) items[`job-pilotto.${host}.password`] = {value: password, account: 'job-pilotto', comment: `email=${email}`, created: new Date().toISOString()};
  writePrivate(file, JSON.stringify(items, null, 2));
  return Object.keys(accounts);
}

// The hosts a run signed in at, from its app log: the extension logged "account page: <move>" with mode sign-in for the host AND filled a password from the Keychain there (a sign-UP fills one
// too, with mode sign-up, and is not a sign-in). Hosts only, never a value. -> [host]
export function signedInHosts(appLog) {
  const text = String(appLog || ''), hostOf = found => found[1];
  const mode = new Set([...text.matchAll(/account page: [a-z-]+ \{[^}\n]*"host":"([^"]+)"[^}\n]*"mode":"sign-in"/g)].map(hostOf));
  return [...new Set([...text.matchAll(/password filled from the Keychain \{[^}\n]*"host":"([^"]+)"/g)].map(hostOf).filter(host => mode.has(host)))];
}

// The accounts a REPLAY signs in with (replay-net.mjs): a row whose live run signed in (record.json testAccountHosts, else its app log) gets a FAKE account for each of those hosts, so the recorded login
// response is followed exactly as live; every other row gets none, as live. Never the Keychain and never a CI secret: a replay talks to no site, so what is typed is never checked (the same row replayed
// with a fake email and password reached the same form with the same answers, 16 Oct 2026). The password is random per run and is never kept. -> {host: {email, password}}
export const REPLAY_EMAIL = 'test-account@example.com';
export function replayAccounts(record, appLog) {
  const hosts = Array.isArray(record?.testAccountHosts) ? record.testAccountHosts : signedInHosts(appLog);
  return Object.fromEntries(hosts.filter(host => HOST.test(host)).map(host => [host, {email: REPLAY_EMAIL, password: crypto.randomBytes(12).toString('base64url')}]));
}

// The values the privacy tripwire lets through: a listed test account's email only (its password field is never read).
export const allowedValues = accounts => Object.values(accounts).map(one => String(one.email).toLowerCase());

// The privacy tripwire's other half: a test account's PASSWORD must never be in what a run saves (logs, captures, records, page dumps). Scans the text files of the run's
// folders for each password (never printed: the reason names the host); a hit deletes those folders. -> '' or the reason.
export function passwordLeak(dirs, accounts) {
  const secrets = Object.entries(accounts).filter(([, one]) => String(one.password || '').length >= 6).map(([host, one]) => [host, Buffer.from(one.password)]);
  if (!secrets.length) return '';
  const hits = new Set();
  const walk = dir => {
    let entries = []; try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name !== 'isolated-secrets.json') { let data; try { data = fs.readFileSync(file); } catch { continue; } for (const [host, secret] of secrets) if (data.includes(secret)) hits.add(host); }
    }
  };
  for (const dir of dirs.filter(Boolean)) walk(dir);
  if (!hits.size) return '';
  for (const dir of dirs.filter(Boolean)) fs.rmSync(dir, {recursive: true, force: true});
  return `privacy tripwire: the test account's password for ${[...hits].join(', ')} was found in the run's saved files; they were deleted`;
}

// The applicant's contact for a posting whose host has a listed test account: the account's own email replaces the fake applicant's. The app signs in only where THIS email
// has an account on the host (lib/site-accounts.js modeOf: a saved item for another email is "not ours"), so with the fake address the extension signed up instead of
// signing in (Richemont Workday, 16 Oct 2026). Any other host keeps the fake applicant. -> a new contact.
export function contactFor(contact, accounts, url) {
  let host = ''; try { host = new URL(url).hostname.toLowerCase(); } catch { return contact; }
  const own = Object.entries(accounts || {}).find(([name]) => name.toLowerCase() === host);
  return own ? {...contact, email: own[1].email} : contact;
}

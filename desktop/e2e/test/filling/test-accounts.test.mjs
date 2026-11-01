// A live pool row signs in only with a listed test account (lib/test-accounts.mjs, docs/rules/applying.md "Signing in"): the account goes into the test
// app's own secrets file as the product saves a site password, the privacy tripwire lets that email through and nothing else of the owner's. Pure: no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {allowedValues, seedTestAccounts, testAccounts} from '../../lib/test-accounts.mjs';
import {tripwire} from '../../lib/privacy-tripwire.mjs';
import {contactFor, passwordLeak} from '../../lib/test-accounts.mjs';

test('accounts come from the CI secret or the Keychain items of listed hosts only; a malformed host is dropped', () => {
  const ci = testAccounts({JP_TEST_ACCOUNTS: JSON.stringify({'tenant.wd3.example.test': {email: 'a@b.test', password: 'p'}, 'not a host': {email: 'x', password: 'y'}})});
  assert.deepEqual(Object.keys(ci), ['tenant.wd3.example.test']);
  const asked = [];
  const mac = testAccounts({JP_TEST_ACCOUNT_HOSTS: 'jobs.example.test, missing.example.test'}, {keychain: service => { asked.push(service); if (service.includes('missing')) throw new Error('not found'); return service.endsWith('.email') ? 'me@x.test' : 'secret'; }});
  assert.deepEqual(mac, {'jobs.example.test': {email: 'me@x.test', password: 'secret'}});
  assert.ok(asked.every(service => service.startsWith('job-pilotto.test-account.')), asked.join(' '));
  assert.deepEqual(testAccounts({}, {hosts: () => []}), {}, 'nothing listed: no sign-in anywhere');
});

test('a seeded account is the product\'s saved site password: the host\'s item, the email in its comment, a private file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-accounts-'));
  fs.writeFileSync(path.join(dir, 'isolated-secrets.json'), JSON.stringify({'job-pilotto.other.test.password': {value: 'keep'}}));
  assert.deepEqual(seedTestAccounts(dir, {'jobs.example.test': {email: 'me@x.test', password: 'secret'}}), ['jobs.example.test']);
  const items = JSON.parse(fs.readFileSync(path.join(dir, 'isolated-secrets.json'), 'utf8'));
  assert.equal(items['job-pilotto.jobs.example.test.password'].value, 'secret');
  assert.equal(items['job-pilotto.jobs.example.test.password'].comment, 'email=me@x.test');
  assert.equal(items['job-pilotto.other.test.password'].value, 'keep', 'an item already there stays');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'isolated-secrets.json')).mode & 0o777, 0o600);
});

test('the tripwire lets a listed test account\'s email through, never the owner\'s other values', async () => {
  const values = [['owner@real.test', 'email'], ['Ada Owner', 'name']];
  const page = fields => ({typed: async () => fields, clear: async () => {}});
  const allow = allowedValues({'jobs.example.test': {email: 'Owner@Real.test', password: 'secret'}});
  assert.equal((await tripwire(page([{label: 'Email', value: 'owner@real.test'}]), {values, allow})).ok, true);
  const tripped = await tripwire(page([{label: 'Email', value: 'owner@real.test'}, {label: 'Name', value: 'Ada Owner'}]), {values, allow});
  assert.equal(tripped.ok, false);
  assert.match(tripped.reason, /name typed into "Name"/);
  assert.equal((await tripwire(page([{label: 'Email', value: 'owner@real.test'}]), {values})).ok, false, 'no allow list: the email still trips');
});

test('a Mac with no host list reads the listed test accounts only; a real account\'s item is never asked for', () => {
  const asked = [];
  const got = testAccounts({}, {hosts: () => ['jobs.example.test'], keychain: service => { asked.push(service); return 'v'; }});
  assert.deepEqual(Object.keys(got), ['jobs.example.test']);
  assert.ok(asked.length === 2 && asked.every(service => service.startsWith('job-pilotto.test-account.')), asked.join(' '));
  assert.deepEqual(testAccounts({JP_TEST_ACCOUNT_HOSTS: ''}, {hosts: () => ['jobs.example.test'], keychain: () => 'v'}), {}, 'an empty list means none');
});

test('the tripwire fails and deletes the run\'s files when a test account\'s password is in them, and never prints it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-leak-'));
  fs.writeFileSync(path.join(dir, 'app.log'), 'typed Hunter-Two-9 into the box');
  const accounts = {'jobs.example.test': {email: 'me@x.test', password: 'Hunter-Two-9'}};
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-clean-'));
  fs.writeFileSync(path.join(clean, 'app.log'), 'nothing here');
  assert.equal(passwordLeak([clean], accounts), '');
  assert.ok(fs.existsSync(clean));
  const page = {typed: async () => [], clear: async () => {}};
  const check = await tripwire(page, {values: new Map(), saved: [dir], accounts});
  assert.equal(check.ok, false);
  assert.match(check.reason, /jobs\.example\.test/);
  assert.ok(!check.reason.includes('Hunter-Two-9'));
  assert.ok(!fs.existsSync(dir), 'the run\'s saved files are deleted');
});

test('a posting on a host with a test account gets that account\'s email as the applicant\'s; any other host keeps the fake one', () => {
  const accounts = {'tenant.wd3.example.test': {email: 'inbox+jp@x.test', password: 'secret1'}};
  const contact = {full_name: 'Ada Tester', email: 'ada.tester@example.test'};
  assert.equal(contactFor(contact, accounts, 'https://tenant.wd3.example.test/en/job/1').email, 'inbox+jp@x.test');
  assert.equal(contactFor(contact, accounts, 'https://other.example.test/job/1').email, 'ada.tester@example.test');
  assert.equal(contactFor(contact, {}, 'https://tenant.wd3.example.test/x').email, 'ada.tester@example.test');
  assert.equal(contactFor(contact, accounts, 'not a url'), contact);
  assert.equal(contactFor(contact, accounts, 'https://tenant.wd3.example.test/x').full_name, 'Ada Tester', 'only the email changes');
});

test('with that email the app signs in at the host (modeOf), with the fake one it signs up', async () => {
  const {modeOf} = await import('../../../lib/site-accounts.js');
  const item = 'inbox+jp@x.test';   // the seeded item\'s recorded email
  assert.equal(modeOf({}, 'tenant.wd3.example.test', 'ada.tester@example.test', item, true), 'sign-up');
  assert.equal(modeOf({}, 'tenant.wd3.example.test', item, item, true), 'sign-in');
});

// The owner's REAL account on a site that also has a test account (career74.sapsf.eu, 16 Oct 2026): the real one is the product's item job-pilotto.<host>.password in the owner's Keychain
// (Settings → Credentials), the test one job-pilotto.test-account.<host>.*. A test reads the second and never the first, for any host.
import {testHosts, replayAccounts} from '../../lib/test-accounts.mjs';
const SAME_HOST = 'career74.sapsf.eu', REAL = `job-pilotto.${SAME_HOST}.password`, REAL_EMAIL = `job-pilotto.${SAME_HOST}.email`;

test('on a host where the owner has a real account too, a test reads only the test-account items, never the real one', () => {
  const asked = [], secrets = {[REAL]: 'REAL-PASSWORD', [REAL_EMAIL]: 'real@example.com', [`job-pilotto.test-account.${SAME_HOST}.password`]: 'test-password', [`job-pilotto.test-account.${SAME_HOST}.email`]: 'test+jp@example.com'};
  const got = testAccounts({JP_TEST_ACCOUNT_HOSTS: SAME_HOST}, {keychain: service => { asked.push(service); if (!(service in secrets)) throw new Error('not found'); return secrets[service]; }});
  assert.deepEqual(got, {[SAME_HOST]: {email: 'test+jp@example.com', password: 'test-password'}}, 'the test account, not the real one');
  assert.deepEqual(asked.sort(), [`job-pilotto.test-account.${SAME_HOST}.email`, `job-pilotto.test-account.${SAME_HOST}.password`]);
  assert.ok(!asked.includes(REAL) && !asked.includes(REAL_EMAIL), 'the real item is never asked for');
  // a host that has ONLY the real account is not a test account at all: nothing is read
  const none = [], dump = ['job-pilotto.career74.sapsf.eu.password', 'job-pilotto.other.example.password'].map(name => `keychain: "/x"\nclass: "genp"\nattributes:\n    "acct"<blob>="job-pilotto"\n    "icmt"<blob>="email=real@example.com"\n    "svce"<blob>="${name}"\n`).join('');
  assert.deepEqual(testHosts(() => dump), [], 'a real account is never listed as a test account');
  assert.deepEqual(testAccounts({}, {hosts: () => testHosts(() => dump), keychain: service => { none.push(service); return 'v'; }}), {});
  assert.deepEqual(none, [], 'no item is read for a host that has only a real account');
});

test('a replay and the harness\'s own source never reach for a real account\'s item', () => {
  assert.deepEqual(replayAccounts({testAccountHosts: [SAME_HOST]}, '')[SAME_HOST].email, 'test-account@example.com', 'a replay signs in with a fake account, whatever the Keychain holds');
  const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const source = read('lib/test-accounts.mjs');
  const keychainReads = [...source.matchAll(/keychain\(`([^`]*)`\)/g)].map(found => found[1]);
  assert.deepEqual(keychainReads, ['job-pilotto.test-account.${host}.email', 'job-pilotto.test-account.${host}.password'], 'the only Keychain reads of the test accounts name test-account items');
  assert.ok(!/replayAccounts[\s\S]{0,600}find-generic-password/.test(source), 'replayAccounts does not touch the Keychain');
});

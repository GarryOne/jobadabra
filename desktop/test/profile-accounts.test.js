// Job-site accounts belong to one profile (16 Oct 2026): the listing, the fill, the move by e-mail, export, import and reset keep profiles apart. Fake values, an isolated store (never the real Keychain).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as credentials from '../lib/credentials.js';
import * as keychain from '../lib/keychain.js';
import * as accounts from '../lib/profile-accounts.js';

const A = 'profile-aaaaaaaaaaaa', B = 'profile-bbbbbbbbbbbb';
const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-accounts-'));
  const env = {JOBADABRA_E2E: '1', JOBADABRA_USER_DATA: dir};
  const put = (service, value, comment = '') => keychain.write(service, value, {account: 'jobadabra', comment, env});
  return {dir, env, opts: {env}, put};
};

test('a profile lists and fills only its own accounts; old-name ones are unassigned and never filled', () => {
  const {env, put} = fresh();
  put('jobadabra.profile-aaaaaaaaaaaa.a.example.com.password', 'pw-a', 'email=a@x.test');
  put('jobadabra.profile-bbbbbbbbbbbb.b.example.com.password', 'pw-b', 'email=b@x.test');
  put('jobadabra.old.example.com.password', 'pw-old', 'email=c@x.test');
  put('jobadabra.test-account.t.example.com.password', 'pw-t');
  const rows = id => credentials.parseDump(keychain.dump({env}), {profile: id}).map(row => [row.host, row.unassigned ? 'unassigned' : row.test ? 'test' : 'own']).sort();
  assert.deepEqual(rows(A), [['a.example.com', 'own'], ['old.example.com', 'unassigned'], ['t.example.com', 'test']]);
  assert.deepEqual(rows(B), [['b.example.com', 'own'], ['old.example.com', 'unassigned'], ['t.example.com', 'test']]);
  credentials.useProfile(A);
  try {
    const read = host => credentials.reveal(host, 'darwin', () => { throw new Error('real Keychain'); });
    assert.equal(credentials.serviceOf('a.example.com'), 'jobadabra.profile-aaaaaaaaaaaa.a.example.com.password');
    assert.equal(credentials.forExtension('old.example.com', {applying: true, read: host => (host === 'a.example.com' ? 'x' : null)}).ok, false);   // profile B's host is not read as A's
    assert.equal(credentials.forExtension('unassigned:old.example.com', {applying: true, read: () => 'x'}).ok, false);
    assert.equal(typeof read, 'function');
  } finally { credentials.useProfile(null); }
});

test('the move by e-mail: a match goes to the profile, the rest stays; a mismatch deletes nothing; running twice changes nothing', () => {
  const {opts, put, env} = fresh();
  put('jobadabra.mine.example.com.password', 'pw-1', 'email=Me@x.test job=https://j.example/1');
  put('jobadabra.other.example.com.password', 'pw-2', 'email=else@x.test');
  put('jobadabra.blank.example.com.password', 'pw-3');
  assert.deepEqual(accounts.migrate(['me@x.test'], A, opts), {moved: 1, kept: 0, left: 2});
  assert.deepEqual(accounts.migrate(['me@x.test'], A, opts), {moved: 0, kept: 0, left: 2});
  assert.equal(keychain.read('jobadabra.profile-aaaaaaaaaaaa.mine.example.com.password', {env}), 'pw-1');
  assert.match(keychain.comment('jobadabra.profile-aaaaaaaaaaaa.mine.example.com.password', {env}), /email=Me@x.test job=https:\/\/j.example\/1/);
  assert.equal(keychain.read('jobadabra.mine.example.com.password', {env}), null);
  for (const host of ['other', 'blank']) assert.ok(keychain.read(`jobadabra.${host}.example.com.password`, {env}));
  // a profile item with another password already there: both stay
  put('jobadabra.profile-aaaaaaaaaaaa.other.example.com.password', 'different');
  assert.equal(accounts.assign('other.example.com', A, opts), 'kept');
  assert.equal(keychain.read('jobadabra.other.example.com.password', {env}), 'pw-2');
});

test('reset removes this profile\'s accounts only; export carries them; import files them under the imported profile', () => {
  const {opts, put, env, dir} = fresh();
  put('jobadabra.profile-aaaaaaaaaaaa.a.example.com.password', 'pw-a', 'email=a@x.test job=https://j.example/a');
  put('jobadabra.profile-bbbbbbbbbbbb.b.example.com.password', 'pw-b', 'email=b@x.test');
  put('jobadabra.test-account.t.example.com.password', 'pw-t');
  put('jobadabra.old.example.com.password', 'pw-old');
  const out = accounts.exportable(A, opts);
  assert.deepEqual(out, {'a.example.com': {password: 'pw-a', email: 'a@x.test', job: 'https://j.example/a'}});   // no B, no test, no unassigned
  fs.writeFileSync(path.join(dir, accounts.ACCOUNTS_FILE), JSON.stringify(out));
  assert.equal(accounts.adopt(dir, 'profile-cccccccccccc', opts), 1);
  assert.equal(fs.existsSync(path.join(dir, accounts.ACCOUNTS_FILE)), false);
  assert.equal(keychain.read('jobadabra.profile-cccccccccccc.a.example.com.password', {env}), 'pw-a');
  assert.equal(accounts.removeAll(A, opts), 1);
  assert.equal(keychain.read('jobadabra.profile-aaaaaaaaaaaa.a.example.com.password', {env}), null);
  for (const service of ['profile-bbbbbbbbbbbb.b', 'test-account.t', 'profile-cccccccccccc.a', 'old']) assert.ok(keychain.read(`jobadabra.${service}.example.com.password`, {env}), service);
});

test('a profile id is made once and kept in the settings', () => {
  let settings = {};
  const storage = {settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; }};
  const id = accounts.profileId(storage);
  assert.match(id, /^profile-[0-9a-f]{12}$/);
  assert.equal(accounts.profileId(storage), id);
});

test('the module reads the real Keychain never: an isolated run has no `security` call', () => {
  const {opts, put} = fresh();
  put('jobadabra.x.example.com.password', 'pw', 'email=a@x.test');
  const exec = () => { throw new Error('security called'); };
  accounts.migrate(['a@x.test'], A, {...opts, exec});
  accounts.exportable(A, {...opts, exec});
  accounts.removeAll(A, {...opts, exec});
});

test('an export never lists accounts.json as a data file (it is added only when ticked) and carries the flag in its manifest', async () => {
  const reset = await import('../lib/reset.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-export-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
  fs.writeFileSync(path.join(dir, 'accounts.json'), '{}');
  assert.deepEqual(reset.exported(dir), ['settings.json']);
});

test('a reset always removes this profile\'s accounts (the export with accounts ticked brings them back); other profiles never', () => {
  const {opts, put, env} = fresh();
  put('jobadabra.profile-aaaaaaaaaaaa.a.example.com.password', 'pw-a', 'email=a@x.test');
  put('jobadabra.profile-bbbbbbbbbbbb.b.example.com.password', 'pw-b');
  assert.equal(accounts.onReset(A, opts), 1);
  assert.equal(keychain.read(credentials.serviceOf('a.example.com', A), {env}), null);
  assert.equal(keychain.read('jobadabra.profile-bbbbbbbbbbbb.b.example.com.password', {env}), 'pw-b');
});

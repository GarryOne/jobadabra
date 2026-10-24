// What a test run or a live-test twin may reach of this Mac's Keychain (lib/keychain.js). 8 Oct 2026: a local e2e run that reached an account page
// overwrote the owner's real job-site password: the engine's writes were not isolated and the app's reads (lib/credentials.js, lib/site-password.js) never were.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as keychain from '../lib/keychain.js';
import * as pipeline from '../lib/pipeline.js';
import {forget, list} from '../lib/credentials.js';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-keychain-'));
const spy = answer => { const calls = []; const exec = (cmd, args) => { calls.push([cmd, ...args]); return answer(args); }; return {calls, exec}; };
const realItem = service => `keychain: "/Users/x/login.keychain-db"\nclass: "genp"\nattributes:\n    "acct"<blob>="job-pilotto"\n    "cdat"<timedate>=0x00  "20261008115402Z\\000"\n    "icmt"<blob>="email=owner@example.com"\n    "svce"<blob>="${service}"\n`;
const save = (dir, items) => fs.writeFileSync(path.join(dir, 'isolated-secrets.json'), JSON.stringify(items));

test('a test run never calls `security`: reads, comments and the item list come from its own file', () => {
  const dir = folder(), env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_USER_DATA: dir};
  save(dir, {'job-pilotto.e2e.test.password': {value: 'Test-Pass-11', account: 'job-pilotto', comment: 'email=e2e@example.com', created: '20261008120000'}});
  const {calls, exec} = spy(() => 'real-secret');
  assert.equal(keychain.read('job-pilotto.e2e.test.password', {env, exec, platform: 'darwin'}), 'Test-Pass-11');
  assert.equal(keychain.read('job-pilotto.sites.password', {env, exec, platform: 'darwin'}), null);   // the owner's job-site password is not there
  assert.equal(keychain.read('job-pilotto.google.refresh-token', {env, exec, platform: 'darwin'}), null);
  assert.equal(keychain.comment('job-pilotto.e2e.test.password', {env, exec, platform: 'darwin'}), 'email=e2e@example.com');
  assert.match(keychain.dump({env, exec, platform: 'darwin'}), /job-pilotto\.e2e\.test\.password/);
  assert.deepEqual(calls, []);
});

test('an isolated run without its own folder reads nothing, and still never the Keychain', () => {
  const {calls, exec} = spy(() => 'real-secret');
  assert.equal(keychain.read('job-pilotto.sites.password', {env: {JOB_PILOTTO_E2E: '1'}, exec, platform: 'darwin'}), null);
  assert.equal(keychain.dump({env: {JOB_PILOTTO_E2E: '1'}, exec, platform: 'darwin'}), '');
  assert.deepEqual(calls, []);
});

test('the twin reads the real job-site passwords (docs/live-test.md) after its own file, and nothing else of the owner\'s', () => {
  const dir = folder(), env = {JOB_PILOTTO_TWIN: '1', JOB_PILOTTO_USER_DATA: dir};
  save(dir, {'job-pilotto.made-by-twin.example.password': {value: 'Twin-Pass-12', account: 'job-pilotto', comment: '', created: '20261008120000'}});
  const {calls, exec} = spy(args => (args[0] === 'dump-keychain'
    ? realItem('job-pilotto.coop.example.password') + realItem('job-pilotto.google.refresh-token') + realItem('job-pilotto.mac-sign.password') : 'real-secret\n'));
  assert.equal(keychain.read('job-pilotto.made-by-twin.example.password', {env, exec, platform: 'darwin'}), 'Twin-Pass-12');
  assert.equal(calls.length, 0);   // its own file first
  assert.equal(keychain.read('job-pilotto.coop.example.password', {env, exec, platform: 'darwin'}), 'real-secret');
  assert.equal(keychain.read('job-pilotto.sites.password', {env, exec, platform: 'darwin'}), 'real-secret');
  const before = calls.length;
  assert.equal(keychain.read('job-pilotto.google.refresh-token', {env, exec, platform: 'darwin'}), null);
  assert.equal(keychain.read('job-pilotto.report.token', {env, exec, platform: 'darwin'}), null);
  assert.equal(calls.length, before);   // the Google sign-in and the report token are never asked for
  const text = keychain.dump({env, exec, platform: 'darwin'});
  assert.match(text, /coop\.example/);
  assert.match(text, /made-by-twin/);
  assert.doesNotMatch(text, /google|mac-sign/);
});

test('a user\'s app reads the Keychain as before', () => {
  const {calls, exec} = spy(() => 'real-secret\n');
  assert.equal(keychain.read('job-pilotto.sites.password', {account: 'job-pilotto', env: {}, exec, platform: 'darwin'}), 'real-secret');
  assert.deepEqual(calls[0], ['security', 'find-generic-password', '-a', 'job-pilotto', '-s', 'job-pilotto.sites.password', '-w']);
});

test('Settings → Credentials in a test run lists the run\'s own accounts, never the owner\'s', () => {
  const dir = folder();
  save(dir, {'job-pilotto.e2e.wd3.myworkdayjobs.com.password': {value: 'x', account: 'job-pilotto', comment: 'email=e2e@example.com job=https://x', created: '20261008140534'},
    'job-pilotto.sites.password': {value: 'y', account: 'job-pilotto', comment: '', created: '20261008140534'}});
  const saved = {...process.env};
  Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_USER_DATA: dir});
  try {
    const {calls, exec} = spy(() => realItem('job-pilotto.coop.example.password'));
    assert.deepEqual(list('darwin', exec).rows.map(row => [row.host, row.email]), [['e2e.wd3.myworkdayjobs.com', 'e2e@example.com']]);
    assert.deepEqual(calls, []);
  } finally { for (const name of ['JOB_PILOTTO_E2E', 'JOB_PILOTTO_USER_DATA']) if (name in saved) process.env[name] = saved[name]; else delete process.env[name]; }
});

test('the engine gets the run\'s own secrets file in a test run or a twin, and never for a user', () => {
  const storage = {settings: () => ({}), secret: () => '', path: name => '/tmp/' + name, secretsPresent: () => ({}), saveSettings: () => {}};
  const dir = folder();
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOB_PILOTTO_E2E: '1', JOB_PILOTTO_USER_DATA: dir}).JOB_PILOTTO_ISOLATED_SECRETS, path.join(dir, 'isolated-secrets.json'));
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOB_PILOTTO_TWIN: '1', JOB_PILOTTO_USER_DATA: dir}).JOB_PILOTTO_ISOLATED_SECRETS, path.join(dir, 'isolated-secrets.json'));
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOB_PILOTTO_USER_DATA: dir}).JOB_PILOTTO_ISOLATED_SECRETS, undefined);
});

test('every Keychain call of the app goes through lib/keychain.js (a new one would skip the isolation)', () => {
  const lib = path.join(import.meta.dirname, '..', 'lib');
  const direct = fs.readdirSync(lib).filter(name => name.endsWith('.js') && name !== 'keychain.js')
    .filter(name => /execFile(?:Sync)?\(\s*'security'|\['find-generic-password'|'dump-keychain'|'add-generic-password'/.test(fs.readFileSync(path.join(lib, name), 'utf8')));
  assert.deepEqual(direct, []);
});

// Settings → Credentials → Delete (owner, 9 Oct 2026): a test run or the twin deletes only from its own file; a user's app deletes the one item it names.
test('Delete: isolated runs delete from their own file only; the app deletes the named item; a bad host is refused', () => {
  for (const env of [{JOB_PILOTTO_E2E: '1'}, {JOB_PILOTTO_TWIN: '1'}]) {
    const dir = folder(); env.JOB_PILOTTO_USER_DATA = dir;
    save(dir, {'job-pilotto.e2e.test.password': {value: 'Test-Pass-11', account: 'job-pilotto'}});
    const {calls, exec} = spy(() => '');
    assert.equal(keychain.remove('job-pilotto.e2e.test.password', {account: 'job-pilotto', env, exec, platform: 'darwin'}), true);
    assert.equal(keychain.remove('job-pilotto.career2.successfactors.eu.password', {account: 'job-pilotto', env, exec, platform: 'darwin'}), false);   // a real item: never
    assert.deepEqual(calls, []);
    assert.deepEqual(keychain.isolatedItems(env), {});
  }
  const {calls, exec} = spy(() => '');
  assert.equal(keychain.remove('job-pilotto.e2e.wd3.myworkdayjobs.com.password', {account: 'job-pilotto', env: {}, exec, platform: 'darwin'}), true);
  assert.deepEqual(calls, [['security', 'delete-generic-password', '-a', 'job-pilotto', '-s', 'job-pilotto.e2e.wd3.myworkdayjobs.com.password']]);
  const none = spy(() => '');
  assert.equal(forget('sites', 'darwin', none.exec), false);   // the shared job-site password is not a site row
  assert.equal(forget('a b.com; rm', 'darwin', none.exec), false);
  assert.deepEqual(none.calls, []);
});

test('the twin also reads the one Ready to send owner secret item, read-only, and no other job-pilotto item', () => {
  const dir = folder(), env = {JOB_PILOTTO_TWIN: '1', JOB_PILOTTO_USER_DATA: dir};
  const {calls, exec} = spy(() => 'real-secret\n');
  assert.equal(keychain.read('job-pilotto.ready.owner_secret', {env, exec, platform: 'darwin'}), 'real-secret');
  for (const other of ['job-pilotto.ready.other', 'job-pilotto.anthropic.ready_key', 'job-pilotto.cloudflare.api_token', 'job-pilotto.notion.token-desktop-real']) {
    const before = calls.length;
    assert.equal(keychain.read(other, {env, exec, platform: 'darwin'}), null, other);
    assert.equal(calls.length, before);
  }
  assert.equal(keychain.read('job-pilotto.ready.owner_secret', {env: {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_USER_DATA: dir}, exec, platform: 'darwin'}), null);   // an e2e run never reaches it
});

test('a test that passes no fake exec can never change the real Keychain (24 Oct 2026: a Python test wrote the owner\'s Keychain)', () => {
  assert.throws(() => keychain.write('job-pilotto.x.token', 'v', {env: {NODE_TEST_CONTEXT: 'child-v8'}, platform: 'darwin'}), /real Keychain/);
  assert.throws(() => keychain.remove('job-pilotto.x.token', {env: {NODE_TEST_CONTEXT: 'child-v8'}, platform: 'darwin'}), /real Keychain/);
  const {calls, exec} = spy(() => '');
  assert.equal(keychain.write('job-pilotto.x.token', 'v', {env: {NODE_TEST_CONTEXT: 'child-v8'}, exec, platform: 'darwin'}), true);   // a fake exec is fine
  assert.equal(calls.length, 1);
});

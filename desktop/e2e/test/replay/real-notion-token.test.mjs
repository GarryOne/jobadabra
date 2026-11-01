// The twin reads the app's own Notion token, only for the sync: in the child's env, never argv/log/file/the twin app; the stale Keychain item is not read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {TOKEN_VAR, appToken, runWithAppToken} from '../../lib/real-notion-token.mjs';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standIn = {isEncryptionAvailable: () => true, encryptString: v => Buffer.from(`sealed:${v}`), decryptString: b => b.toString().replace(/^sealed:/, '')};
const folderWith = value => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-token-'));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify(value ? {NOTION_TOKEN: Buffer.from(`sealed:${value}`).toString('base64')} : {}));
  return dir;
};

test('the token is decrypted from the app\'s secrets.json', () => assert.equal(appToken(folderWith('ntn_fake'), standIn), 'ntn_fake'));

test('a missing or undecryptable token stops with a plain sentence, never a fallback', () => {
  assert.throws(() => appToken(folderWith(''), standIn), /cannot be read/);
  assert.throws(() => appToken(folderWith('x'), {...standIn, decryptString: () => { throw new Error('no key'); }}), /cannot be read/);
  assert.throws(() => appToken(folderWith('x'), {...standIn, isEncryptionAvailable: () => false}), /not available/);
});

test('the token goes to the child through its env only, never argv, and the error text never holds it', () => {
  let seen;
  const status = runWithAppToken({folder: folderWith('ntn_fake'), safeStorage: standIn, command: ['python3', 'copy.py', '--from', `env:${TOKEN_VAR}`], env: {PATH: '/bin'},
    spawn: (cmd, args, options) => { seen = {cmd, args, options}; return {status: 0}; }});
  assert.equal(status, 0);
  assert.equal(seen.options.env[TOKEN_VAR], 'ntn_fake');
  assert.ok(!JSON.stringify([seen.cmd, seen.args]).includes('ntn_fake'));
  assert.notEqual(seen.options.stdio[1], 'inherit');   // its stdout is not shown
  assert.throws(() => appToken(folderWith('ntn_fake'), {...standIn, isEncryptionAvailable: () => false}), error => !error.message.includes('ntn_fake'));
});

test('twin.mjs no longer reads the stale Keychain item, and the real token never reaches the twin app\'s env', () => {
  const twin = fs.readFileSync(path.join(here, '..', 'twin.mjs'), 'utf8');
  assert.ok(!twin.includes('token-desktop-real'), 'the stale Keychain item is still named');
  assert.ok(!twin.includes('SOURCE_TOKEN ='), 'a Keychain source token constant is back');
  assert.ok(twin.includes('real-notion-token-main.mjs'));
  assert.ok(!twin.includes(TOKEN_VAR), 'the twin process itself must never see the real token');
  const start = twin.slice(twin.indexOf('const startApp'), twin.indexOf('let app = startApp()'));
  assert.ok(!/NOTION_TOKEN: *(real|source)/i.test(start) && !start.includes('source'), 'the twin app\'s env names a real token');
});

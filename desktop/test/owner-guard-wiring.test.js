// The owner guard is test-harness only (owner, 14 Oct 2026): the app honours the harness's list only under JOBADABRA_E2E, removes it from its environment, and nothing
// else in the shipped code reads it. Proves it cannot switch on in a user's app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {takeOwnerValues} from '../lib/owner-guard-env.js';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = JSON.stringify([['port vale', 'location']]);

test('a user\'s app (no JOBADABRA_E2E) never has a list, even with the variable set; the variable is removed either way', () => {
  const env = {JOBADABRA_E2E_OWNER_VALUES: LIST};
  assert.equal(takeOwnerValues(env), null);
  assert.equal('JOBADABRA_E2E_OWNER_VALUES' in env, false);
});

test('under the harness the list is taken once and gone from the environment (no child process can read it)', () => {
  const env = {JOBADABRA_E2E: '1', JOBADABRA_E2E_OWNER_VALUES: LIST};
  assert.deepEqual([...takeOwnerValues(env)], [['port vale', 'location']]);
  assert.equal('JOBADABRA_E2E_OWNER_VALUES' in env, false);
  assert.equal(takeOwnerValues({JOBADABRA_E2E: '1'}), null);
});

test('the shipped code reads the variable in one file; the answer env gets its list only from there', () => {
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(item => item.isDirectory() ? (/node_modules|shared|e2e|test|dist|build/.test(item.name) ? [] : walk(path.join(dir, item.name))) : [path.join(dir, item.name)]);
  const readers = walk(DESKTOP).filter(file => /\.(js|mjs)$/.test(file) && fs.readFileSync(file, 'utf8').includes('JOBADABRA_E2E_OWNER_VALUES')).map(file => path.relative(DESKTOP, file));
  assert.deepEqual(readers, [path.join('lib', 'owner-guard-env.js')]);
  const env = fs.readFileSync(path.join(DESKTOP, 'lib', 'server-env.js'), 'utf8');
  assert.match(env, /ownerValues: OWNER_VALUES/);
  assert.equal((env.match(/ownerValues:/g) || []).length, 1);
});

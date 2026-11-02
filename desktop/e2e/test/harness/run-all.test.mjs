import assert from 'node:assert/strict';
import {test} from 'node:test';
import {defaultParallel, keychainEnv, pickSuites, argProblems} from '../../run-all.mjs';

const ALL = ['jobs', 'personas', 'quality', 'settings', 'wizard'], cadence = {personas: 'manual', quality: 'nightly'};

test('run-all picks what a manual CI run would: everything that is not manual; --manual adds them; --only names exactly', () => {
  assert.deepEqual(pickSuites({all: ALL, cadence}), ['jobs', 'quality', 'settings', 'wizard']);
  assert.deepEqual(pickSuites({all: ALL, cadence, manual: true}), ALL);
  assert.deepEqual(pickSuites({all: ALL, cadence, only: 'personas,jobs'}), ['jobs', 'personas']);
  assert.deepEqual(pickSuites({all: ALL, cadence, skip: 'quality,wizard'}), ['jobs', 'settings']);
  assert.throws(() => pickSuites({all: ALL, cadence, only: 'nope'}), /unknown suite: nope/);
  assert.throws(() => pickSuites({all: ALL, cadence, skip: 'nope'}), /unknown suite to skip: nope/);
});

test('secrets already in the environment are kept; the rest come from the Keychain, per suite', () => {
  const store = {'jobadabra.e2e.notion_token': 'w', 'jobadabra.e2e.notion_token_quality': 'q'};
  const found = keychainEnv(['jobs', 'quality'], {env: {E2E_NOTION_TOKEN: 'already'}, read: service => store[service] || ''});
  assert.deepEqual(found, {E2E_NOTION_TOKEN_QUALITY: 'q'});   // the wizard token is set, the jobs token is not in the Keychain
});

test('the Anthropic key is never read from the Keychain, even when it is there (owner, 5 Oct 2026: no local e2e run loads it)', () => {
  const asked = [];
  const found = keychainEnv(['jobs'], {env: {}, read: service => { asked.push(service); return 'secret'; }});
  assert.ok(!asked.some(service => /anthropic/i.test(service)), `asked for ${asked.join(', ')}`);
  assert.ok(!('E2E_ANTHROPIC_KEY' in found));
});

test('run-all runs suites in parallel by default only when each has its own Notion token', () => {
  const env = {E2E_NOTION_TOKEN_JOBS: 'x', E2E_NOTION_TOKEN_SETTINGS: 'x', E2E_NOTION_TOKEN_QUALITY: 'x'};
  assert.equal(defaultParallel(['jobs', 'settings', 'quality'], env), 3);
  assert.equal(defaultParallel(['jobs', 'settings', 'wizard'], env), 1, 'wizard has no token of its own');
  assert.equal(defaultParallel(['jobs'], env), 1, 'one suite is just one');
  const ten = 'abcdefghij'.split('');
  assert.equal(defaultParallel(ten, Object.fromEntries(ten.map(x => [`E2E_NOTION_TOKEN_${x.toUpperCase()}`, 'x']))), 4, 'at most four');
});

test('a bare word is refused, never ignored: a suite name alone does not run every suite', () => {
  const suites = ['applyflows', 'activity'];
  assert.deepEqual(argProblems(['applyflows'], suites), ['"applyflows" is not a flag: to run that suite, use --only applyflows']);
  assert.match(argProblems(['--olny', 'jobs'], suites)[0], /unknown argument "--olny"/);
  assert.deepEqual(argProblems(['--only'], suites), ['--only needs a value']);
  assert.deepEqual(argProblems(['--only', '--manual'], suites), ['--only needs a value']);
  assert.deepEqual(argProblems(['--only', 'applyflows', '--skip', 'activity', '--parallel', '2', '--manual'], suites), []);
  assert.deepEqual(argProblems([], suites), []);
});

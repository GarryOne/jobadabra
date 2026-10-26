// The end-to-end test app runs on the owner's Mac, whose Keychain holds the owner's real Google sign-in and Telegram bot: the engine is told so, and then ignores the
// Keychain (src/secret_store.py). It is set only by the journey (JOB_PILOTTO_E2E in the app's own environment), never for a user.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

const storage = {settings: () => ({}), secret: () => '', path: name => '/tmp/' + name, secretsPresent: () => ({}), saveSettings: () => {}};

test('the engine is told it runs in the end-to-end journey, and only then', () => {
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOB_PILOTTO_E2E: '1'}).JOB_PILOTTO_E2E, '1');
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin'}).JOB_PILOTTO_E2E, undefined);
});

test('a test candidate\'s Profile reaches the engine only in a test run, and never for a user', () => {
  const file = '/tmp/golden/profile.md';
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_PROFILE_FILE: file}).JOB_PILOTTO_PROFILE_FILE, file);
  // the variable alone (no test run) is ignored, and so is a Profile file named directly: the engine's environment is a whitelist
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOB_PILOTTO_E2E_PROFILE_FILE: file}).JOB_PILOTTO_PROFILE_FILE, undefined);
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOB_PILOTTO_E2E: '1', JOB_PILOTTO_PROFILE_FILE: file}).JOB_PILOTTO_PROFILE_FILE, undefined);
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOB_PILOTTO_E2E: '1'}).JOB_PILOTTO_PROFILE_FILE, undefined);
});

test('the e2e Python step map\'s recorder reaches the engine only in a test run that records it', () => {
  const recorder = {E2E_PY_COVERAGE_DIR: '/tmp/pycov-x', PYTHONPATH: '/repo/desktop/e2e/lib/pycov'};
  const env = pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOB_PILOTTO_E2E: '1', ...recorder});
  assert.deepEqual([env.E2E_PY_COVERAGE_DIR, env.PYTHONPATH], [recorder.E2E_PY_COVERAGE_DIR, recorder.PYTHONPATH]);
  for (const parent of [{PATH: '/usr/bin', ...recorder}, {PATH: '/usr/bin', JOB_PILOTTO_E2E: '1', PYTHONPATH: '/somewhere'}]) {
    const off = pipeline.pipelineEnv(storage, parent);
    assert.deepEqual([off.E2E_PY_COVERAGE_DIR, off.PYTHONPATH], [undefined, undefined], 'a user\'s PYTHONPATH never reaches the engine');
  }
});

// JOB_PILOTTO_MODEL_OVERRIDE (the end-to-end journey, desktop/e2e): every AI step the app starts runs on that one model, never Sonnet or Opus.
// Checked in a child process, because the override is read when the modules load.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const script = `
import * as pipeline from './lib/pipeline.js';
import * as strategy from './lib/strategy.js';
import * as cv from './lib/cv.js';
import * as cvChange from './lib/cv-change.js';
const storage = {settings: () => ({aiEngine: 'cli', claudeCode: {path: '/x/claude'}}), secret: () => '', path: name => '/tmp/' + name, secretsPresent: () => ({}), saveSettings: () => {}};
const env = pipeline.pipelineEnv(storage, {PATH: '/usr/bin'});
console.log(JSON.stringify({models: Object.fromEntries(Object.entries(env).filter(([key]) => /_MODEL$/.test(key))), strategy: strategy.MODEL, cv: cv.MODEL, cvChange: cvChange.MODEL}));`;

test('with the override set, every model the app hands to the engine and every model it calls itself is the override', () => {
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8',
    env: {...process.env, JOB_PILOTTO_MODEL_OVERRIDE: 'claude-haiku-4-5'}}).trim().split('\n').pop());
  const all = [...Object.values(out.models), out.strategy, out.cv, out.cvChange];
  assert.ok(Object.keys(out.models).length >= 7, `expected the engine's model settings, got ${Object.keys(out.models)}`);
  assert.deepEqual([...new Set(all)], ['claude-haiku-4-5']);
  for (const name of ['JOB_PILOTTO_INTERVIEW_MODEL', 'JOB_PILOTTO_PREP_MODEL', 'JOB_PILOTTO_REJECTION_MODEL', 'JOB_PILOTTO_MAIN_MODEL', 'JOB_PILOTTO_BIG_MODEL'])
    assert.equal(out.models[name], 'claude-haiku-4-5', name);
});

test('without the override nothing changes: the app still uses its own models', () => {
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8',
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'JOB_PILOTTO_MODEL_OVERRIDE'))}).trim().split('\n').pop());
  assert.equal(out.models.JOB_PILOTTO_SCORE_MODEL, 'claude-sonnet-5-5');
  assert.equal(out.strategy, 'claude-sonnet-5-5');
  assert.equal(out.models.JOB_PILOTTO_INTERVIEW_MODEL, undefined);
  assert.equal(out.models.JOB_PILOTTO_MAIN_MODEL, undefined);
  assert.equal(out.models.JOB_PILOTTO_BIG_MODEL, undefined);
});

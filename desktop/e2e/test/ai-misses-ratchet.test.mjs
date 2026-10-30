// Keeps stored-answer suites at their committed AI miss ceiling, using only temporary artifacts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {entryProblems, lanesProblems} from '../../../tools/lanes-check.mjs';
import {aiMissesVerdict, checkAiMisses} from '../lib/no-real-ai.mjs';

const ZERO_SUITES = ['stores', 'interviews', 'wander', 'activityfailures', 'jobs', 'strategy', 'employers', 'settings', 'applyflows', 'apply', 'recorded', 'wizard', 'updates', 'focus', 'cardstates', 'focusdismiss', 'visitread'];

test('the real registry parses and protects all 17 suites that reached zero misses', () => {
  const text = fs.readFileSync(new URL('../lanes.json', import.meta.url), 'utf8');
  assert.deepEqual(lanesProblems(null, text), []);
  const {suites} = JSON.parse(text);
  for (const name of ZERO_SUITES) assert.equal(suites[name]?.aiMissesMax, 0, name);
  for (const name of ['failuresnotion', 'failureschannels', 'calendar', 'storemove']) {
    assert.equal(Object.hasOwn(suites[name] || {}, 'aiMissesMax'), false, name);
  }
});

test('a ceiling-only backbone entry is valid; ceilings must be non-negative integers', () => {
  for (const aiMissesMax of [0, 2]) assert.deepEqual(entryProblems({aiMissesMax}), []);
  for (const aiMissesMax of [-1, 0.5, '0', null, true]) {
    assert.match(entryProblems({aiMissesMax}).join('; '), /aiMissesMax must be a non-negative integer/);
  }
  assert.notDeepEqual(entryProblems({}), [], 'empty entries still need a lane or a ceiling');
  assert.match(entryProblems({aiMissesMax: 0, lane: 'tolerant'}).join('; '), /input must be/);
});

function artifacts(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-misses-ratchet-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

function miss(dir, name, request) {
  fs.mkdirSync(path.join(dir, 'ai-misses'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'ai-misses', `${name}.json`), JSON.stringify({url: '/v1/messages', request}));
}

test('zero misses with max zero passes even when the misses folder is absent', t => {
  assert.deepEqual(checkAiMisses(artifacts(t), {aiMissesMax: 0}), {ok: true, misses: 0, max: 0, message: ''});
});

test('one miss with max zero reports only its request key and never the fixture prompt', t => {
  const dir = artifacts(t), prompt = 'private fixture prompt must never be logged';
  miss(dir, '0123456789abcdef0123456789abcdef', {messages: [{role: 'user', content: prompt}]});
  const result = checkAiMisses(dir, {aiMissesMax: 0});
  assert.equal(result.message.includes(prompt), false);
  assert.deepEqual(result, {
    ok: false, misses: 1, max: 0,
    message: 'AI asks with no stored answer: 1 (allowed 0); first ask key: 0123456789abcdef0123456789abcdef',
  });
});

test('without aiMissesMax, misses never fail and the artifact folder is not read', t => {
  const dir = artifacts(t);
  miss(dir, 'first', {input: 'an unanswered ask'});
  assert.equal(checkAiMisses(dir, {}).ok, true);
  assert.equal(checkAiMisses(null, undefined).ok, true);
  assert.deepEqual(aiMissesVerdict(100, {}), {ok: true, misses: 100, max: null, message: ''});
});

test('counts only JSON files, sorts the keys and includes the ceiling boundary', t => {
  const dir = artifacts(t);
  miss(dir, 'z', {input: 'last prompt'});
  miss(dir, 'a', {input: [{role: 'user', content: [{type: 'input_text', text: 'first\nprompt'}]}]});
  fs.writeFileSync(path.join(dir, 'ai-misses', 'notes.txt'), 'not a miss');
  fs.mkdirSync(path.join(dir, 'ai-misses', 'folder.json'));
  assert.deepEqual(checkAiMisses(dir, {aiMissesMax: 2}), {ok: true, misses: 2, max: 2, message: ''});
  assert.deepEqual(checkAiMisses(dir, {aiMissesMax: 1}), {
    ok: false, misses: 2, max: 1, message: 'AI asks with no stored answer: 2 (allowed 1); first ask key: a',
  });
});

test('a malformed miss still counts and cannot turn the suite green', t => {
  const dir = artifacts(t);
  miss(dir, 'broken', {});
  fs.writeFileSync(path.join(dir, 'ai-misses', 'broken.json'), '{');
  assert.deepEqual(checkAiMisses(dir, {aiMissesMax: 0}), {
    ok: false, misses: 1, max: 0, message: 'AI asks with no stored answer: 1 (allowed 0); first ask key: broken',
  });
});

test('the existing suite finalizer fails after teardown and keeps the AI failure in artifacts', async t => {
  const dir = artifacts(t), messages = [], key = Symbol.for('ai-misses-ratchet-test');
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', message => messages.push(message));
  const ctx = {ARTIFACTS: dir, runner: {results: [], summary() { return this.results.some(result => result.status === 'failed'); }},
    close: async () => miss(dir, 'late', {messages: [{role: 'user', content: 'ask during teardown'}]})};
  globalThis[key] = ctx;
  t.after(() => { delete globalThis[key]; });
  // Stub only app startup, staging and Keychain boundaries; the finalizer, registry and artifact writers are real.
  const stubs = new Map([
    ['../lib/app.mjs', 'export const assertNothingQueued = () => {}; export const traceFiles = () => [];'],
    ['../lib/context.mjs', "export const SUITES = ['wizard']; export const openContext = async () => globalThis[Symbol.for('ai-misses-ratchet-test')];"],
    ['../lib/ensure-staged.mjs', 'export const ensureStaged = () => {};'],
    ['../lib/keychain-guard.mjs', 'export const snapshot = () => null; export const keychainChanges = () => [];'],
    ['../suites/wizard.mjs', "export const name = 'wizard'; export const light = true; export const run = async () => {};"],
  ].map(([file, source]) => [new URL(file, import.meta.url).href, source]));
  const hooks = registerHooks({load(url, context, next) {
    return stubs.has(url) ? {format: 'module', source: stubs.get(url), shortCircuit: true} : next(url, context);
  }});
  t.after(() => hooks.deregister());
  const {runSuite} = await import('../lib/suite-main.mjs');
  const result = await runSuite('wizard');
  assert.equal(result.code, 1);
  assert.match(result.failed[0], /AI asks with no stored answer: 1 \(allowed 0\); first ask key: late/);
  assert.ok(messages.some(message => message.includes('E2E-cause: ai wizard')));
  assert.equal(messages.join('\n').includes('ask during teardown'), false);
  const failures = JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8'));
  assert.equal(failures[0].message, 'AI asks with no stored answer: 1 (allowed 0); first ask key: late');
  const steps = JSON.parse(fs.readFileSync(path.join(dir, 'steps.json'), 'utf8'));
  assert.equal(steps.results[0].status, 'failed');
});

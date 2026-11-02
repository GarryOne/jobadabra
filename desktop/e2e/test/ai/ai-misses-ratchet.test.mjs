// Keeps stored-answer suites at their committed AI miss ceiling, using only temporary artifacts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {entryProblems, lanesProblems, namesException} from '../../../../tools/lanes-check.mjs';
import {NON_BACKBONE} from '../../lib/suite-shards.mjs';
import {createHash} from 'node:crypto';
import {aiMissesVerdict, checkAiMisses} from '../../lib/no-real-ai.mjs';

// The 8-hex digest the miss line shows for a text part (lib/ai-miss-name.mjs): the line proves the part without holding it.
const digestOf = text => createHash('sha256').update(text).digest('hex').slice(0, 8);

test('every suite defaults to zero misses unless its lane or a named exception exempts it', t => {
  const text = fs.readFileSync(new URL('../../lanes.json', import.meta.url), 'utf8');
  assert.deepEqual(lanesProblems(null, text), []);
  const {suites} = JSON.parse(text), dir = artifacts(t);
  miss(dir, 'unanswered', {input: 'fixture only'});
  const files = fs.readdirSync(new URL('../../suites/', import.meta.url)).filter(file => file.endsWith('.mjs'));
  for (const file of files) {
    const name = file.slice(0, -4), lane = suites[name];
    const exempt = NON_BACKBONE.includes(lane?.lane) || namesException(lane);   // the same predicates the run uses (Gitar on #2664)
    const result = checkAiMisses(dir, lane);
    assert.equal(result.max, exempt ? null : 0, name);
    assert.equal(result.ok, exempt, `${name}: an unknown ask must fail every backbone suite`);
  }
  assert.equal(suites.personas.lane, 'tolerant', 'personas reports only (owner, 31 Oct 2026), so it has no exception to hold');
  assert.match(suites.explore.aiMissesException, /manual.only/);
  assert.equal(checkAiMisses(dir, undefined).ok, false, 'new suites inherit zero without a registry edit');
});

test('a new unlisted backbone suite defaults to zero without a registry entry', t => {
  const {suites} = JSON.parse(fs.readFileSync(new URL('../../lanes.json', import.meta.url), 'utf8'));
  const name = 'new-unlisted-backbone-fixture';
  assert.equal(Object.hasOwn(suites, name), false);
  const dir = artifacts(t);
  assert.deepEqual(checkAiMisses(dir, suites[name]), {ok: true, misses: 0, max: 0, message: ''});
  miss(dir, 'new-unknown-ask', {input: 'fictional fixture request'});
  assert.deepEqual(checkAiMisses(dir, suites[name]), {
    ok: false, misses: 1, max: 0,
    message: 'AI asks with no stored answer: 1 (allowed 0); first ask key: new-unknown-ask; first ask: unkeyable (unknown: question identity is not in the request (/v1/messages))',
  });
});

test('a backbone ceiling can only be zero; an exception needs a reason', () => {
  assert.deepEqual(entryProblems({aiMissesMax: 0}), []);
  assert.deepEqual(entryProblems({aiMissesException: 'Held by the owner until the live asks are reviewed.'}), []);
  for (const aiMissesMax of [-1, 0.5, '0', null, true, 1]) {
    assert.match(entryProblems({aiMissesMax}).join('; '), /aiMissesMax must be 0/);
  }
  for (const aiMissesException of ['', '  ', null, 42, 'flaky']) {
    assert.match(entryProblems({aiMissesException}).join('; '), /aiMissesException must name the reason/);
    assert.equal(aiMissesVerdict(1, {aiMissesException}).ok, false, 'invalid exceptions fail closed');
  }
  assert.notDeepEqual(entryProblems({}), [], 'empty entries carry no policy');
  assert.notDeepEqual(entryProblems({aiMissesMax: 0, aiMissesException: 'Held by the owner until its live asks are reviewed.'}), [], 'a ceiling and an exemption conflict');
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

test('one miss with max zero reports its request key, the operation and part digests of the ask, and never the fixture prompt', t => {
  const dir = artifacts(t), prompt = 'private fixture prompt must never be logged';
  miss(dir, '0123456789abcdef0123456789abcdef', {messages: [{role: 'user', content: prompt}]});
  const result = checkAiMisses(dir, {aiMissesMax: 0});
  assert.equal(result.message.includes(prompt), false);
  assert.deepEqual(result, {
    ok: false, misses: 1, max: 0,
    message: `AI asks with no stored answer: 1 (allowed 0); first ask key: 0123456789abcdef0123456789abcdef; first ask: unkeyable (unknown: question identity is not in the request (/v1/messages)); parts: [0] user text ${digestOf(prompt)}`,
  });
});

test('an absent ceiling fails closed; non-backbone lanes and named exceptions do no I/O', t => {
  const dir = artifacts(t);
  miss(dir, 'first', {input: 'an unanswered ask'});
  assert.equal(checkAiMisses(dir, {}).ok, false);
  assert.deepEqual(aiMissesVerdict(100, {}), {ok: false, misses: 100, max: 0, message: 'AI asks with no stored answer: 100 (allowed 0); first ask key: '});
  for (const lane of [{lane: 'tolerant'}, {lane: 'suspended'}, {lane: 'retired'}, {aiMissesException: 'Held by the owner until the live asks are reviewed.'}]) {
    assert.equal(checkAiMisses(null, lane).max, null);
    assert.equal(aiMissesVerdict(100, lane).ok, true);
  }
});

test('counts only JSON files, sorts the keys and includes the ceiling boundary', t => {
  const dir = artifacts(t);
  miss(dir, 'z', {input: 'last prompt'});
  miss(dir, 'a', {input: [{role: 'user', content: [{type: 'input_text', text: 'first\nprompt'}]}]});
  fs.writeFileSync(path.join(dir, 'ai-misses', 'notes.txt'), 'not a miss');
  fs.mkdirSync(path.join(dir, 'ai-misses', 'folder.json'));
  assert.deepEqual(checkAiMisses(dir, {aiMissesMax: 2}), {ok: true, misses: 2, max: 2, message: ''});
  assert.deepEqual(checkAiMisses(dir, {aiMissesMax: 1}), {
    ok: false, misses: 2, max: 1, message: `AI asks with no stored answer: 2 (allowed 1); first ask key: a; first ask: unkeyable (unknown: question identity is not in the request (/v1/messages)); parts: [0] user input_text ${digestOf('first\nprompt')}`,
  });
});

test('a malformed miss still counts and cannot turn the suite green', t => {
  const dir = artifacts(t);
  miss(dir, 'broken', {});
  fs.writeFileSync(path.join(dir, 'ai-misses', 'broken.json'), '{');
  assert.deepEqual(checkAiMisses(dir, {aiMissesMax: 0}), {
    ok: false, misses: 1, max: 0, message: "AI asks with no stored answer: 1 (allowed 0); first ask key: broken; first ask: unreadable miss file (Expected property name or '}' in JSON at position 1 (line 1 column 2))",
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
    ['../../lib/app.mjs', 'export const assertNothingQueued = () => {}; export const traceFiles = () => [];'],
    ['../../lib/context.mjs', "export const SUITES = ['wizard']; export const openContext = async () => globalThis[Symbol.for('ai-misses-ratchet-test')];"],
    ['../../lib/ensure-staged.mjs', 'export const ensureStaged = () => {};'],
    ['../../lib/keychain-guard.mjs', 'export const snapshot = () => null; export const keychainChanges = () => [];'],
    ['../../suites/wizard.mjs', "export const name = 'wizard'; export const light = true; export const run = async () => {};"],
  ].map(([file, source]) => [new URL(file, import.meta.url).href, source]));
  const hooks = registerHooks({load(url, context, next) {
    return stubs.has(url) ? {format: 'module', source: stubs.get(url), shortCircuit: true} : next(url, context);
  }});
  t.after(() => hooks.deregister());
  const {runSuite} = await import('../../lib/suite-main.mjs');
  const result = await runSuite('wizard');
  assert.equal(result.code, 1);
  assert.match(result.failed[0], /AI asks with no stored answer: 1 \(allowed 0\); first ask key: late/);
  assert.ok(messages.some(message => message.includes('E2E-cause: ai wizard')));
  assert.equal(messages.join('\n').includes('ask during teardown'), false);
  const failures = JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8'));
  assert.match(failures[0].message, /^AI asks with no stored answer: 1 \(allowed 0\); first ask key: late; first ask: unkeyable/);
  const steps = JSON.parse(fs.readFileSync(path.join(dir, 'steps.json'), 'utf8'));
  assert.equal(steps.results[0].status, 'failed');
});

test('the post-close guard prints the measured zero required by saved-gate CI proof', async t => {
  const dir = artifacts(t), lines = [];
  t.mock.method(console, 'log', line => lines.push(line));
  const {writeFinalFailures} = await import('../../lib/suite-main.mjs');
  const ctx = {ARTIFACTS: dir, runner: {results: []}};
  assert.equal(writeFinalFailures('activity', ctx, {}), false);
  assert.ok(lines.includes('AI asks with no stored answer: 0 (allowed 0)'), lines.join('\n'));
  assert.deepEqual(ctx.runner.results, []);
});

// Refused unstored AI asks lead failure artifacts and Telegram, ahead of downstream step symptoms.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {annotationLines, writeSuiteFailures} from '../lib/artifacts.mjs';
import {messageOf, stepCauses} from '../ci-alert.mjs';
import {noteBrokerCapped, takeCapped} from '../lib/ai-cap.mjs';

// Reduced recorded shapes from main run 40987274061, jobs and failureschannels.
const capped = {neurons: null, cap: 100000, skipped: 0, steps: [], at: '2026-10-30T01:42:57.349Z'};
const miss = {url: '/v1/messages', request: {messages: [{role: 'user', content: 'The search (JSON): {"role_words": ["site reliability engineer", "platform engineer"]}\nThe titles:\n1. marketing manager 43'}]}};
const key = '7f'.repeat(32);
const reason = 'broker: budget:own-share 60.1% of 60% (scheduled)';
const head = `AI asks with no stored answer: 1 (first: ${key}); the AI was refused: ${reason}`;
const env = {GITHUB_WORKFLOW: 'CI', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42', GITHUB_SHA: '4709c81'};

function fixture(t, {withMiss = true, withCap = withMiss, log = ''} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-miss-cause-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  if (withMiss) {
    fs.mkdirSync(path.join(dir, 'ai-misses'));
    fs.writeFileSync(path.join(dir, 'ai-misses', `${key}.json`), JSON.stringify(miss));
  }
  if (withCap) fs.writeFileSync(path.join(dir, 'ai-capped.json'), JSON.stringify(capped));
  if (log) {
    fs.mkdirSync(path.join(dir, 'logs'));
    fs.writeFileSync(path.join(dir, 'logs', 'engine.log'), log);
  }
  return dir;
}

for (const symptom of [
  'the step did not finish within 395 s (it hung)',
  'the added match was not kept and scored',
  'the check did not end ok [harness check: the fault this step set up never fired]',
]) {
  test(`unstored/refused AI leads the artifact and Telegram: ${symptom}`, async t => {
    const dir = fixture(t, {log: `InternalServerError: ai-capped: the Codex broker said no (${reason}); it answers from saved replies or the step goes grey`});
    writeSuiteFailures(dir, 'jobs', [{name: 'read jobs', status: 'failed', note: symptom}], {});
    const [record] = JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8'));
    assert.ok(record.message.startsWith(head), record.message);
    assert.ok(record.message.endsWith(symptom), 'the original symptom remains available');
    assert.equal(Object.hasOwn(record, 'cause'), false);
    assert.doesNotMatch(record.message, /The search \(JSON\):|role_words/);
    assert.equal(Object.hasOwn(record, 'environment'), false, 'naming AI evidence must not add environment metadata');
    assert.deepEqual([record.suite, record.step], ['jobs', 'read jobs']);
    const [annotation] = annotationLines([record]);
    const message = decodeURIComponent(annotation.split('::').at(-1));
    const fetcher = async url => ({json: async () => url.includes('/jobs?')
      ? {jobs: [{id: 7, name: 'jobs', conclusion: 'failure'}]}
      : [{title: 'jobs · read jobs', message}]});
    const causes = await stepCauses('42', env, fetcher, {suites: {}});
    const alert = messageOf({status: 'failure', causes, env, lanes: {suites: {}}});
    assert.doesNotMatch(alert.text, /The search \(JSON\):|role_words/);
    // The alert splits a message at "; " into bullets: the named cause is the first problem, the refusal the second, the symptom after.
    const [first, second] = head.split('; ');
    assert.ok(alert.text.includes('• ' + first), alert.text);
    assert.ok(alert.text.indexOf('• ' + first) < alert.text.indexOf('• ' + second), alert.text);
    assert.match(alert.text, /read jobs/);
  });
}

test('a failure without AI misses or cap evidence is unchanged', t => {
  const dir = fixture(t, {withMiss: false});
  const note = 'the step did not finish within 395 s (it hung)';
  writeSuiteFailures(dir, 'jobs', [{name: 'read jobs', status: 'failed', note}], {});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8')),
    [{suite: 'jobs', step: 'read jobs', message: note}]);
});

test('a cap log alone names the refusal without inventing an ask key', t => {
  const dir = fixture(t, {withMiss: false, log: `ai-capped: jobs (Codex broker: ${reason})\n`});
  writeSuiteFailures(dir, 'jobs', [{name: 'read jobs', status: 'failed', note: 'wrong value'}], {});
  const [record] = JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8'));
  assert.ok(record.message.startsWith(`AI asks with no stored answer: 0 (first: unavailable); the AI was refused: ${reason}`), record.message);
  assert.equal(Object.hasOwn(record, 'cause'), false);
  assert.equal(Object.hasOwn(record, 'environment'), false);
});

test('naming AI evidence preserves an existing environment flag', t => {
  const dir = fixture(t);
  writeSuiteFailures(dir, 'jobs', [{name: 'read jobs', status: 'failed', note: 'wrong value', environment: true}], {});
  const [record] = JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8'));
  assert.equal(Object.hasOwn(record, 'cause'), false);
  assert.equal(record.environment, true);
});

test('a first-seen miss without refusal evidence leaves an unrelated failure unchanged', t => {
  const dir = fixture(t, {withCap: false});
  writeSuiteFailures(dir, 'jobs', [{name: 'read jobs', status: 'failed', note: 'wrong value'}], {});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8')),
    [{suite: 'jobs', step: 'read jobs', message: 'wrong value'}]);
});

// Beta 41135642422's qualityai: the harness logged the broker's refusal only to the job log, and the record said "no refusal reason recorded".
test('a broker refusal the harness noted names its reason without any log file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-miss-cause-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const quiet = console.log;
  console.log = () => {};
  try { noteBrokerCapped(reason, {E2E_ARTIFACTS: dir, E2E_SUITE: 'qualityai'}); } finally { console.log = quiet; takeCapped(); }
  writeSuiteFailures(dir, 'qualityai', [{name: 'facts', status: 'failed', note: 'the facts are not exact'}], {});
  const [record] = JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'), 'utf8'));
  assert.ok(record.message.startsWith(`AI asks with no stored answer: 0 (first: unavailable); the AI was refused: ${reason}`), record.message);
});

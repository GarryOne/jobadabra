// A suite whose AI is all stand-in fails when a call went on to a real model (lib/no-real-ai.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeSuiteFailures} from '../../lib/artifacts.mjs';
import {flakyProof} from '../../lib/flaky-proof.mjs';
import {storedAnswer} from '../../lib/ai-answers.mjs';
import {writeFinalFailures} from '../../lib/suite-main.mjs';
import * as aiGuards from '../../lib/no-real-ai.mjs';
const {assertNoRealAi, realAiCalls} = aiGuards;

test('paid calls on either proxy are counted and fail the check', () => {
  assert.equal(realAiCalls({proxy: {stats: {paid: 1}}, openaiProxy: {stats: {paid: 2}}}), 3);
  assert.equal(realAiCalls({proxy: {stats: {}}, openaiProxy: null}), 0);
  assert.doesNotThrow(() => assertNoRealAi({proxy: {stats: {calls: 9, canned: 9, failed: 0}}, openaiProxy: null}));
  assert.throws(() => assertNoRealAi({proxy: {stats: {paid: 1}}, openaiProxy: null}), /1 AI call\(s\) reached a real model/);
});

test('offline background questions pass the critical real-model guard unless a call is paid', async () => {
  const names = [], ctx = {proxy: {stats: {calls: 59, failed: 59, paid: 0}}, openaiProxy: {stats: {calls: 8, failed: 8, paid: 0}}};
  const runAlways = async (name, check, options) => { names.push(name); assert.deepEqual(options, {critical: true}); await check(); };
  await aiGuards.runAiGuards({realAi: false, offlineAi: true}, ctx, runAlways);
  assert.deepEqual(names, ['no AI call of this suite reached a real model: the stand-in answered or refused every one']);
  ctx.openaiProxy.stats.paid = 1;
  await assert.rejects(aiGuards.runAiGuards({realAi: false, offlineAi: true}, ctx, runAlways), /1 AI call\(s\) reached a real model/);
  names.length = 0;
  await aiGuards.runAiGuards({realAi: true}, ctx, runAlways);
  assert.deepEqual(names, []);
});


test('late missing-answer refusals become failed artifacts and cannot prove a flaky retry', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-refusal-proof-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const ctx = {runner: {results: [{name: 'journey', status: 'passed'}]}};
  assert.equal(typeof aiGuards.recordAnswerRefusals, 'function');
  assert.equal(aiGuards.recordAnswerRefusals(ctx, []), false);
  assert.equal(ctx.runner.results.length, 1);
  assert.equal(aiGuards.recordAnswerRefusals(ctx, [{code: 'E2E_AI_ANSWER_MISSING', message: 'activityfailures: app.decide zürich has no stored answer'}]), true);
  writeSuiteFailures(dir, 'activityfailures', ctx.runner.results, {});
  const failures = JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json')));
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /E2E_AI_ANSWER_MISSING.*zürich/);
  assert.deepEqual(flakyProof(failures[0].message).harness, 'stored answers');
  assert.equal(flakyProof(failures[0].message).flaky, false);
  assert.match(ctx.stopped, /has no stored answer/);
});


test('the production finalizer rewrites an empty artifact after a late registry refusal', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'late-answer-finalize-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const table = path.join(dir, 'answers.json');
  fs.writeFileSync(table, JSON.stringify({v: 1, answers: {}}));
  const ctx = {ARTIFACTS: dir, runner: {results: [{name: 'journey', status: 'passed'}]}};
  writeSuiteFailures(dir, 'activityfailures', ctx.runner.results, {});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json'))), []);
  assert.throws(() => storedAnswer({headers: {'x-jp-action': 'unrecorded-background'}, body: '{}'}, {
    E2E_AI_ANSWERS: 'backbone', E2E_AI_ANSWERS_FILE: table, E2E_ARTIFACTS: dir, E2E_SUITE: 'activityfailures',
  }), {code: 'E2E_AI_ANSWER_MISSING'});
  assert.equal(writeFinalFailures('activityfailures', ctx, {}), true);
  const failures = JSON.parse(fs.readFileSync(path.join(dir, 'suite-failures.json')));
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /E2E_AI_ANSWER_MISSING.*unrecorded-background/);
  assert.equal(flakyProof(failures[0].message).harness, 'stored answers');
});

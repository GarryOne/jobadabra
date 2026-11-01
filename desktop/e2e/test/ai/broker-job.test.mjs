// A refused broker call skips the job with its reason (never red, never another provider) and leaves one note for the run's single alert (lib/broker-job.mjs, credit-alert.mjs, .github/actions/ai-skipped-alert).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {askOrSkip, cappedDir, noteSkipped} from '../../lib/broker-job.mjs';
import {alertCappedSteps} from '../../credit-alert.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'broker-job-'));
const env = dir => ({AI_CAPPED_DIR: dir, GITHUB_OUTPUT: path.join(dir, 'out.txt')});

test('an answer comes back as text; nothing is written', async () => {
  const dir = temp();
  const answer = await askOrSkip({}, {job: 'x', env: env(dir), ask: async () => ({ok: true, model: 'gpt', tier: 'mid', ms: 900, message: {content: [{text: 'hi'}], usage: {input_tokens: 5, output_tokens: 2}}})});
  assert.deepEqual(answer, {ok: true, text: 'hi', model: 'gpt', tier: 'mid', ms: 900, usage: {input_tokens: 5, output_tokens: 2}});
  assert.equal(fs.existsSync(path.join(dir, 'ai-capped.json')), false);
});

test('capped, no-token and unreachable skip with the reason, write the note and set skipped=true', async () => {
  for (const status of ['capped', 'no-token', 'unreachable']) {
    const dir = temp();
    const answer = await askOrSkip({}, {job: 'ui-verdict', env: env(dir), ask: async () => ({ok: false, status, detail: `broker: budget:week 90% (${status})`})});
    assert.equal(answer.ok, false);
    assert.match(answer.why, /budget:week/);
    assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'ai-capped.json'), 'utf8')).why, /^ui-verdict: broker: budget:week/);
    assert.equal(fs.readFileSync(path.join(dir, 'out.txt'), 'utf8'), 'skipped=true\n');
  }
});

test('any other broker failure is a real failure: the job goes red', async () => {
  await assert.rejects(askOrSkip({}, {job: 'x', env: env(temp()), ask: async () => ({ok: false, status: 422, detail: 'broker: reply-refused'})}), /failed \(422\)/);
});

test('off GitHub the skip is a plain line, on GitHub a warning annotation', () => {
  const logged = [], log = console.log;
  console.log = (...args) => { logged.push(args.join(' ')); };
  try {
    noteSkipped({job: 'x', why: 'capped', env: {}, dir: temp()});
    noteSkipped({job: 'x', why: 'capped', env: {GITHUB_ACTIONS: 'true'}, dir: temp()});
  } finally { console.log = log; }
  assert.deepEqual(logged, ['AI skipped (x): capped', '::warning title=AI skipped (x)::capped']);
});

test('the note lives outside the checkout by default (the fixer\'s git status must not see it)', () => {
  assert.equal(cappedDir({RUNNER_TEMP: '/runner/tmp'}), path.join('/runner/tmp', 'ai-capped'));
});

test('five refused matrix jobs make ONE alert (the owner saw four identical ones)', async () => {
  const root = temp(), sent = [];
  for (const issue of [1, 2, 3, 4, 5]) {
    const dir = path.join(root, `ai-capped-verdict-${issue}`);
    await askOrSkip({}, {job: 'judge verdict', env: env(dir), ask: async () => ({ok: false, status: 'capped', detail: 'broker: budget:week 90% of 88% (scheduled)'})});
  }
  const result = await alertCappedSteps({artifacts: root, verdict: 'Codex refused', env: {GITHUB_RUN_ID: '9', GITHUB_REPOSITORY: 'o/r', CI_ALERTS_TELEGRAM_BOT_TOKEN: 't', CI_ALERTS_TELEGRAM_CHAT_ID: 'c'},
    fetcher: async (_, init) => { sent.push(JSON.parse(init.body)); return {ok: true}; }, log: () => {}});
  assert.equal(sent.length, 1, result);
  assert.match(sent[0].text, /Codex refused/);
  assert.match(sent[0].text, /budget:week/);
});

test('every moved workflow uploads its note and sends the alert once, after its matrix', () => {
  for (const [name, job] of [['ui-verdict', 'ai-skipped'], ['ui-findings', 'ai-skipped'], ['ui-fix', 'ai-skipped']]) {
    const text = fs.readFileSync(new URL(`../../../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    assert.match(text, new RegExp(`  ${job}:\\n    needs: `), name);
    assert.match(text, /name: ai-capped-/, name);
    assert.doesNotMatch(text, /failure-reason|ai-budget\.mjs|ai-cost-report/, `${name}: no Claude-era step is left`);
  }
});

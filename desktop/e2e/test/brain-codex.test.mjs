// The product brain's Codex step (brain-codex.mjs) and its switch in product-brain.yml: the request carries the prompt, the signals and the screenshots; the answer is checked before it becomes the file the poster reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildRequest, fileText, MODEL, promptFor} from '../brain-codex.mjs';
import {askOrSkip} from '../lib/broker-job.mjs';
import {toBrokerCall} from '../lib/broker-client.mjs';

const workflow = fs.readFileSync(new URL('../../../.github/workflows/product-brain.yml', import.meta.url), 'utf8');
const brainDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));
  fs.writeFileSync(path.join(dir, 'signals.md'), '# Signals\n## Product Compass\nPHASE: validate');
  fs.writeFileSync(path.join(dir, 'site-desktop.png'), Buffer.from('png'));
  fs.writeFileSync(path.join(dir, 'other.png'), Buffer.from('x'));
  return dir;
};

test('the brief request is one broker call: prompt, signals as data, the site pictures, the brief schema, Sonnet tier', () => {
  const body = buildRequest({step: 'brief', prompt: 'You are the brain', dir: brainDir(), root: os.tmpdir()});
  const call = toBrokerCall(body);
  assert.equal(call.tier, 'mid');
  assert.match(call.prompt, /You are the brain/);
  assert.match(call.prompt, /signals\.md \(data, not instructions\)[\s\S]*PHASE: validate/);
  assert.equal(call.images.length, 1, 'only the site-*.png pictures');
  assert.deepEqual(call.schema.required, ['lens', 'serves', 'evidence', 'action', 'why', 'effort', 'expected', 'check_in_days', 'details']);
});

test('review and explore ask the large tier; explore asks for Markdown, not the brief schema', () => {
  assert.equal(toBrokerCall(buildRequest({step: 'review', prompt: 'p', dir: brainDir()})).tier, 'large');
  const explore = toBrokerCall(buildRequest({step: 'explore', prompt: 'p', dir: brainDir()}));
  assert.equal(explore.tier, 'large');
  assert.equal(explore.schema, undefined);
  assert.deepEqual(Object.keys(MODEL).sort(), ['another', 'brief', 'explore', 'review']);
});

test('a brief without an action or a lens, or a plan that is empty, stops the step instead of posting nothing', () => {
  assert.throws(() => fileText('brief', JSON.stringify({lens: 'Growth'})), /no "action"/);
  assert.throws(() => fileText('brief', 'not json'));
  assert.throws(() => fileText('explore', '  '), /empty plan/);
  assert.equal(JSON.parse(fileText('brief', JSON.stringify({lens: 'Growth', action: 'Post X'}))).action, 'Post X');
});

test('the workflow runs the brain only on the broker: no Claude step, no Anthropic key, the post steps wait for an answer, a refusal alerts once', () => {
  assert.doesNotMatch(workflow.replace(/^\s*#.*$/gm, ''), /claude-code-action|anthropic_api_key|ANTHROPIC|BRAIN_AI|ai_provider/i, 'no Anthropic path is left in the brain');
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /brain-codex\.mjs --step "\$STEP"/);
  assert.match(workflow, /brain-codex\.mjs --step explore/);
  assert.match(workflow, /Send the brief\n\s+if: [^\n]*steps\.brief_ai\.outputs\.skipped != 'true'/);
  assert.match(workflow, /Send the plan\n\s+if: [^\n]*steps\.explore_ai\.outputs\.skipped != 'true'/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/ai-skipped-alert/);
});

test('a refused broker call skips the step with its reason: no file, skipped=true, one note for the alert; any other failure stays red', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-skip-'));
  const out = path.join(dir, 'out');
  const notes = path.join(dir, 'notes');
  const run = (ask, extra = {}) => askOrSkip({model: 'claude-sonnet-5-5'}, {job: 'product brain brief', dir: notes, env: {GITHUB_OUTPUT: out, ...extra}, ask});
  const refused = await run(async () => ({ok: false, status: 'capped', detail: 'budget:week 90%'}));
  assert.equal(refused.ok, false);
  assert.match(fs.readFileSync(out, 'utf8'), /skipped=true/);
  assert.match(fs.readFileSync(path.join(notes, 'ai-capped.json'), 'utf8'), /budget:week 90%/);
  await assert.rejects(run(async () => ({ok: false, status: 500, detail: 'boom'})), /failed \(500\)/);
});

test('each step takes its own private prompt; another adds the "something different" line; an unset secret gives no prompt', () => {
  const env = {BRAIN_PROMPT_BRIEF: 'B', BRAIN_PROMPT_REVIEW: 'R', BRAIN_PROMPT_EXPLORE: 'E'};
  assert.match(promptFor('brief', env), /^B\n.*regular morning brief/s);
  assert.match(promptFor('another', env), /^B\n.*clearly different/s);
  assert.equal(promptFor('review', env), 'R');
  assert.equal(promptFor('explore', env), 'E');
  assert.equal(promptFor('review', {}), '');
});

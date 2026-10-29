// The product brain's Codex step (brain-codex.mjs) and its switch in product-brain.yml: the request carries the prompt, the signals and the screenshots; the answer is checked before it becomes the file the poster reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildRequest, fileText, MODEL} from '../brain-codex.mjs';
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

test('the workflow runs the brain on Codex by default, with no repo variable, and only an explicit claude uses the API key', () => {
  assert.match(workflow, /BRAIN_AI: .*\|\| 'codex' \}\}/);
  assert.match(workflow, /id-token: write/);
  for (const step of ['brief', 'review', 'explore']) assert.match(workflow, new RegExp(`brain-codex\\.mjs --step ${step === 'brief' ? '"\\$STEP"' : step}`));
  const claudeSteps = workflow.split('\n').filter(line => /^\s+uses: anthropics\/claude-code-action/.test(line)).length;
  assert.equal(claudeSteps, 3);
  const guards = [...workflow.matchAll(/- name: Claude (?:picks|reviews|explores)[^\n]*\n\s+if: ([^\n]*)/g)].map(match => match[1]);
  assert.equal(guards.length, 3);
  for (const guard of guards) assert.match(guard, /env\.BRAIN_AI == 'claude'/, 'a Claude step never runs unless asked');
});

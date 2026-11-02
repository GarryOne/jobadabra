// Each AI answer call summed per engine for the site's per-AI-family metrics (lib/answer-counts.js): counts only, owner 9 Oct 2026.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {addAnswer, mergeAnswers} from '../lib/answer-counts.js';

const trace = (more = {}) => ({fields: 6, returned: 5, kept: 4, empty: 1, proposed: 1, unknownIds: ['salary_x'], stop: 'end_turn', ms: 7200, engine: 'codex',
  provider: 'openai', billing: 'subscription', model: 'gpt-5', profileChars: 900, categories: {normal: 5}, ...more});

test('calls are summed per engine, with time buckets; the unknown ids are only counted', () => {
  const map = new Map();
  addAnswer(map, trace());
  addAnswer(map, trace({ms: 95000, stop: 'max_tokens', kept: 2}));
  assert.equal(addAnswer(map, trace({engine: 'gemini'})), false);
  assert.deepEqual(map.get('codex'), {engine: 'codex', calls: 2, fields: 12, returned: 10, kept: 6, empty: 2, unknown: 2, proposed: 2, cut: 1, ms: [0, 1, 0, 0, 0, 1]});
  assert.ok(!JSON.stringify([...map.values()]).includes('salary_x'));   // never a field id, a model or a size of the profile
  assert.ok(!JSON.stringify([...map.values()]).includes('gpt-5'));
});

test('a failed send is merged back into what came in meanwhile', () => {
  const taken = new Map(), map = new Map();
  addAnswer(taken, trace()); addAnswer(map, trace({engine: 'cli'})); addAnswer(map, trace());
  mergeAnswers(map, taken);
  assert.equal(map.get('codex').calls, 2);
  assert.deepEqual(map.get('codex').ms, [0, 2, 0, 0, 0, 0]);
  assert.equal(map.get('cli').calls, 1);
});

test('the answer trace reaches the reporter, never from a test run (a twin counts: owner, 9 Oct 2026)', () => {
  const env = fs.readFileSync(new URL('../lib/server-env.js', import.meta.url), 'utf8');
  assert.match(env, /onAnswer: trace => \{\n.*appLog\(.fill.*\n(.*withheld.*\n)?\s*answerReporter\(trace\);/);
  const handlers = fs.readFileSync(new URL('../lib/ext-server-handlers.js', import.meta.url), 'utf8');
  assert.match(handlers, /setAnswerReporter\(trace => \{ if \(!testRun\(\)\) recipeReporter\.answer\(trace\)/);
  assert.match(handlers, /const testRun = \(\) => !!process\.env\.JOBADABRA_E2E;/);
});

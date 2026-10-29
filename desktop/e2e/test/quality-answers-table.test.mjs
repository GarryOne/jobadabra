// Mechanically enforce "right" reviewed quality answers with the suite's exact ranking, cap and coverage assertions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadTable} from '../lib/ai-answers.mjs';
import {capViolations, rankingViolations} from '../lib/quality.mjs';

const file = new URL('../fixtures/golden/ai-answers.json', import.meta.url);
const truth = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/truth.json', import.meta.url), 'utf8'));
const scoresOf = table => Object.fromEntries(Object.entries(table.answers['app.score']).map(([id, {reply}]) =>
  [id, JSON.parse(reply.content.filter(part => part.type === 'text').map(part => part.text).join('')).score]));

test('the committed reviewed table loads through the real validator', () => {
  assert.doesNotThrow(() => loadTable(file));
});

test('every stored score names a golden posting and is an integer from 0 to 100', () => {
  const ids = new Set(truth.map(item => String(item.id)));
  const scores = scoresOf(loadTable(file));
  assert.ok(Object.keys(scores).length > 0, 'the reviewed score table must not be empty');
  for (const [id, score] of Object.entries(scores)) {
    assert.ok(ids.has(id), `app.score/${id}: unknown golden posting`);
    assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `app.score/${id}: invalid score ${score}`);
  }
});

test('reviewed scores satisfy the exact quality ranking and unmet-requirement caps', () => {
  const scores = scoresOf(loadTable(file));
  assert.deepEqual(rankingViolations(truth, scores), []);
  assert.deepEqual(capViolations(truth, scores), []);
});

test('every high-fit non-duplicate golden posting has a stored score', () => {
  const scores = scoresOf(loadTable(file));
  assert.deepEqual(truth.filter(item => item.fit === 'high' && !item.duplicateOf && scores[item.id] == null).map(item => item.id), []);
});

test('every decide item has a non-empty answer and text within the engine 600-character limit', () => {
  const items = loadTable(file).items['app.decide'];
  assert.ok(Object.keys(items).length > 0, 'the reviewed decide table must not be empty');
  for (const [key, item] of Object.entries(items)) {
    assert.ok(item.answer.trim(), `app.decide/${key}: empty answer`);
    assert.ok(Array.from(item.text).length <= 600, `app.decide/${key}: text exceeds 600 characters`);
  }
});

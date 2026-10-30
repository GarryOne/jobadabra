// Mechanically enforce "right" reviewed quality answers with the suite's exact ranking, cap and coverage assertions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadTable, questionOf} from '../lib/ai-answers.mjs';
import {hash} from '../lib/ai-answers-engine-items.mjs';
import {capViolations, rankingViolations} from '../lib/quality.mjs';

const file = new URL('../fixtures/golden/ai-answers.json', import.meta.url);
const truth = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/truth.json', import.meta.url), 'utf8'));
// Why (30 Oct 2026, ap): the suites' own feed postings (activityfailures, failuresnotion, jobs) are scored under qu's feed/<hash> keys, outside the golden truth; only keys a suite's fixture declares may stay out of it, and the golden ranking, cap and coverage checks read the golden rows alone.
const fixture = name => JSON.parse(fs.readFileSync(new URL(`../fixtures/golden/${name}`, import.meta.url), 'utf8'));
const feedKeys = new Set([...['activityfailures-feed-asks.json', 'failuresnotion-asks.json'].flatMap(name => fixture(name).feedPostings.map(post => post.key)),
  ...fixture('jobs-asks.json').scorePostings.map(post => post.id)]);
// Why (30 Oct 2026, owner, bb 4/9): reviewed persona scores name their actual fixture postings; withheld scores remain absent, without weakening golden ranking or coverage.
const personaFeedKeys = new Set(['austin', 'sao_paulo'].flatMap(persona => ['acme', 'beta', 'gamma'].flatMap(stem => {
  const {jobs} = JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${persona}/feeds/${stem}.json`, import.meta.url), 'utf8'));
  return jobs.map(job => `feed/${hash({company: `E2E ${stem[0].toUpperCase()}${stem.slice(1)}`, title: job.title.trim(), location: job.location.name.trim()})}`);
})));
const allScoresOf = table => Object.fromEntries(Object.entries(table.answers['app.score']).map(([id, {reply}]) =>
  [id, JSON.parse(reply.content.filter(part => part.type === 'text').map(part => part.text).join('')).score]));
const scoresOf = table => Object.fromEntries(Object.entries(allScoresOf(table)).filter(([id]) => !feedKeys.has(id) && !personaFeedKeys.has(id)));

test('the committed reviewed table loads through the real validator', () => {
  assert.doesNotThrow(() => loadTable(file));
});

test('every stored score names a golden posting and is an integer from 0 to 100', () => {
  const ids = new Set(truth.map(item => String(item.id)));
  const scores = scoresOf(loadTable(file));
  assert.ok(Object.keys(scores).length > 0, 'the reviewed score table must not be empty');
  const stored = allScoresOf(loadTable(file));
  assert.deepEqual([...feedKeys].filter(id => !(id in stored)), [], 'a declared feed posting has no stored score');
  for (const [id, score] of Object.entries(stored).filter(([id]) => feedKeys.has(id) || personaFeedKeys.has(id))) assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `app.score/${id}: invalid score ${score}`);
  for (const [id, score] of Object.entries(scores)) {
    assert.ok(ids.has(id), `app.score/${id}: unknown golden posting`);
    assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `app.score/${id}: invalid score ${score}`);
  }
});

test('every stored persona score retains its captured request and exact posting identity', () => {
  const table = loadTable(file);
  const keys = Object.keys(table.answers['app.score']).filter(key => personaFeedKeys.has(key));
  assert.ok(keys.length > 0);
  for (const key of keys) {
    const request = table.requests?.['app.score']?.[key];
    assert.ok(request, `app.score/${key}: missing captured request`);
    assert.equal(questionOf(request, {}, table).id, key);
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

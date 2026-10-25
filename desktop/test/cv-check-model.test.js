// The CV check card's model (renderer/cv-check-model.js): fixes first and ranked, the folded summary, the cost line that never promises an estimate.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {costLine, documentFacts, fixesOf, passedOf, summaryOf} from '../renderer/cv-check-model.js';
import {cvCheck} from '../lib/demo.js';
import {setCostEngine, setCostsShown} from '../renderer/ai-cost.js';

setCostsShown(true);
setCostEngine(() => 'api');   // these cases are the API-key user's; test/ai-cost.test.js covers every other engine

test('fixes: parser and content review in one list, high first, ties in their order', () => {
  const fixes = fixesOf({ats: {checks: [{label: 'Length', status: 'warn', detail: '3 pages', fix: 'Trim'}, {label: 'Text', status: 'fail', detail: 'No text', fix: 'Export'},
    {label: 'One column', status: 'pass', detail: 'ok', fix: ''}]},
  ai: {fixes: [{where: 'Summary', issue: 'vague', suggestion: 'Name the role', impact: 'medium'}, {where: 'First role', issue: 'implied', suggestion: 'Say it', impact: 'high'}]}});
  assert.deepEqual(fixes.map(fix => [fix.priority, fix.title, fix.from]),
    [['high', 'Text', 'readability'], ['high', 'First role', 'content'], ['medium', 'Length', 'readability'], ['medium', 'Summary', 'content']]);
  assert.equal(fixes[0].suggestion, 'Export');
});

test('every fix and passed check of the demo result is drawn somewhere: nothing the long report said is lost', () => {
  const fixes = fixesOf(cvCheck), passed = passedOf(cvCheck);
  assert.equal(fixes.length + passed.length, cvCheck.ats.checks.length + cvCheck.ai.fixes.length);
  assert.equal(summaryOf(cvCheck), 'Mostly readable · 3 issues · 2 content suggestions');
});

test('summary: not checked, parser only, clean', () => {
  assert.equal(summaryOf(null), 'Not checked yet');
  assert.equal(summaryOf({ats: {verdict: 'Easy to read', checks: [{status: 'pass'}]}}), 'Easy to read · no issues');
  assert.equal(summaryOf({ats: {verdict: 'Hard to read', checks: [{status: 'fail'}]}}), 'Hard to read · 1 issue');
});

test('cost line: no AI for readability; plan allowance, last recorded cost or "varies" for content, never an estimate', () => {
  assert.equal(costLine('readability'), 'No AI usage');
  assert.equal(costLine('content', {billing: 'subscription', ai: {usd: 0.05}}), 'Uses your plan allowance');
  assert.equal(costLine('content', {billing: 'api', ai: {usd: 0.05, billing: 'api'}}), 'Last review: $0.05 · This run may differ.');
  assert.equal(costLine('content', {billing: 'api', ai: {usd: 0.05}}), 'Last review: $0.05 · This run may differ.');   // a result saved before billing was kept
  assert.equal(costLine('content', {billing: 'api', ai: {usd: 0, billing: 'subscription'}}), 'Uses your AI provider; cost varies');   // a plan run says nothing about API cost
  assert.equal(costLine('content', {billing: 'api'}), 'Uses your AI provider; cost varies');
  for (const line of [costLine('content', {billing: 'api'}), costLine('content', {billing: 'api', ai: {usd: 0.05}})]) assert.doesNotMatch(line, /few cents|estimat/i);
});

test('document facts: only what is known', () => {
  assert.equal(documentFacts({pages: 3, size: 335872, addedAt: 'x'}, () => '12 Oct'), '3 pages · 328 KB · Uploaded 12 Oct');
  assert.equal(documentFacts({size: 2.5 * 1024 * 1024}), '2.5 MB');
  assert.equal(documentFacts({}), '');
});

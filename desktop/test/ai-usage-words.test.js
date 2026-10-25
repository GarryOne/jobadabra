// The quiet "who pays" line around an AI action (owner, 18 Oct 2026): app credits, the API account or the plan, before and after; a real cost only when
// measured on an API account, never an invented $0, never a guessed estimate (renderer/ai-engine-view.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lastCost, usageAfter, usageBefore} from '../renderer/ai-engine-view.js';
import {setCostEngine, setCostsShown} from '../renderer/ai-cost.js';

setCostsShown(true);
setCostEngine(() => 'api');   // the API-key user's cases; test/ai-cost.test.js covers every other engine

test('before: who pays, from the engine in charge', () => {
  assert.equal(usageBefore({aiFree: true}), 'Uses your AI credits.');
  assert.equal(usageBefore({aiEngine: 'api'}, true), 'Billed to your API account.');
  assert.equal(usageBefore({aiEngine: 'openai'}), 'Billed to your API account.');
  assert.equal(usageBefore({aiEngine: 'cli'}), 'Uses your plan allowance.');
  assert.equal(usageBefore({aiEngine: 'codex'}), 'Uses your plan allowance.');
  assert.equal(usageBefore({}), '', 'no AI set up: no line');
});

test('after: the measured cost on an API account, otherwise who paid; never $0', () => {
  assert.equal(usageAfter({paidBy: 'api', usd: 0.0312}), 'Cost $0.03');
  assert.equal(usageAfter({paidBy: 'api', usd: 0.004}), 'Cost $0.004');
  assert.equal(usageAfter({paidBy: 'api', usd: 0}), 'Billed to your API account');
  assert.equal(usageAfter({paidBy: 'plan', usd: 0}), 'Used your plan allowance');
  assert.equal(usageAfter({paidBy: 'credits', usd: 0.02}), 'Used your AI credits');
  assert.equal(usageAfter({}), '');
  assert.equal(lastCost({paidBy: 'api', usd: 0.03}), 'Last draft: $0.03');
  assert.equal(lastCost({paidBy: 'plan', usd: 0}), '');
  for (const words of [usageAfter({paidBy: 'api', usd: 0}), lastCost({paidBy: 'api', usd: 0})]) assert.doesNotMatch(words, /\$0(\.0+)?\b/);
});

// Keeps apply outside the aggregate clock while preserving its job limit and three shards.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {budgetMsOf, stopMsOf} from '../lib/runner.mjs';
import * as applySuite from '../suites/apply.mjs';

test('apply opts out of the aggregate budget', () => {
  assert.equal(applySuite.aggregateBudget, false);
  assert.equal(budgetMsOf(applySuite), Infinity);
});

test('apply has no start-time force-stop', () => {
  assert.equal(stopMsOf(applySuite), null);
});

test('apply keeps its 20-minute job limit and three shards', () => {
  assert.equal(applySuite.minutes, 20);
  assert.equal(applySuite.shards, 3);
});

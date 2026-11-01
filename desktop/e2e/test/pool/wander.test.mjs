// The random walk is a plan first: the same seed replays it, another seed walks another, no seed is the short fixed plan, and every plan is something the suite can carry out.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FAULTS, FIXED_PLAN, MOVES, START_STATES, WALK_LENGTH, describe, planWalk} from '../../lib/wander.mjs';
import {VIEWS} from '../../lib/uicheck.mjs';

test('no seed is the fixed plan; the same seed replays; another seed differs', () => {
  assert.equal(planWalk(0), FIXED_PLAN);
  assert.deepEqual(planWalk(4242), planWalk(4242));
  assert.notEqual(describe(planWalk(4242)), describe(planWalk(4243)));
});

test('every plan is well formed over many seeds', () => {
  const seenStates = new Set(), seenFaults = new Set(), seenMoves = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const plan = planWalk(seed);
    assert.equal(plan.steps.length, WALK_LENGTH);
    seenStates.add(plan.state.id);
    for (const step of plan.steps) {
      seenMoves.add(step.move);
      assert.ok(MOVES.includes(step.move));
      if (step.view) assert.ok(VIEWS.includes(step.view));
      if (step.views) assert.ok(step.views.every(view => VIEWS.includes(view)));
    }
    assert.ok(plan.steps.filter(step => step.move === 'crash').length <= 1, 'one crash per walk');
    if (plan.fault) {
      seenFaults.add(plan.fault.id);
      assert.ok(plan.fault.from >= 0 && plan.fault.until > plan.fault.from && plan.fault.until <= WALK_LENGTH);
    }
  }
  assert.equal(seenStates.size, START_STATES.length, 'every start state is reached');
  assert.equal(seenFaults.size, FAULTS.length, 'every fault is reached');
  assert.equal(seenMoves.size, MOVES.length, 'every move is reached');
});

// The critical-journey registry (critical-journeys.json) names real steps, gives every journey a tier and copies no safety or data mark.
// Reaches: ../critical-journeys.json, ../lib/critical-journeys.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {ensureStaged} from '../lib/ensure-staged.mjs';
import {journeySuites, loadJourneys, missingSteps, registrySteps} from '../lib/critical-journeys.mjs';
import {SUITES} from '../lib/context.mjs';

ensureStaged(fileURLToPath(new URL('../..', import.meta.url)));
const registry = loadJourneys();

// Why (1 Nov 2026, owner via mac-07: "'Find jobs using your browser' this is not critical", "Move all 3 to integration"): J3 is out; the registry has J0-J2, J4-J12 and the tier additions J14-J19 (J13 Strategy waits for its suite to return).
test('the registry holds the journeys J0-J2, J4-J12 and the tier additions, each with a name and steps', () => {
  assert.deepEqual(registry.journeys.map(journey => journey.id), ['J0', 'J1', 'J2', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9', 'J10', 'J11', 'J12', 'J14', 'J15', 'J16', 'J17', 'J18', 'J19']);
  for (const journey of registry.journeys) {
    assert.ok(journey.name.length > 10, `${journey.id} has the owner's name`);
    assert.ok(journey.steps.length > 0, `${journey.id} has steps`);
  }
  assert.ok(!journeySuites(registry).includes('visitsauto'), 'J3 moved to integration: its suite holds no registry step');
  assert.ok(registry.kept.length > 0, 'the safety or data steps no journey owns are kept in their own group');
});

// Why (1 Nov 2026, owner via mac-07): tier 1 = "it blocks the user's flow", runs after every merge and blocks the beta; tier 2 = night burn-in only, reported, never blocks.
test('every journey has tier 1 or 2, and the owner\'s first-tier journeys are tier 1', () => {
  for (const journey of registry.journeys) assert.ok([1, 2].includes(journey.tier), `${journey.id} has a tier`);
  const tier = id => registry.journeys.find(journey => journey.id === id)?.tier;
  for (const id of ['J0', 'J1', 'J2', 'J4', 'J5', 'J6', 'J7', 'J9', 'J10', 'J11', 'J12', 'J14']) assert.equal(tier(id), 1, id);
  assert.equal(tier('J8'), 2, 'Tailor CV: a failed tailor leaves the base CV, so it degrades but does not block');
});

test('every registry step is in its suite (a rename or a removal fails here)', () => {
  assert.deepEqual(missingSteps(registry), []);
  for (const suite of journeySuites(registry)) assert.ok(SUITES.includes(suite), `${suite} is a suite`);
});

test('a registry step renamed in its suite is reported with its group', () => {
  const renamed = structuredClone(registry);
  const step = renamed.journeys.find(journey => journey.id === 'J12').steps[0];
  step.step = `${step.step} (renamed)`;
  const kept = renamed.kept[0];
  kept.step = `${kept.step} (renamed too)`;
  assert.deepEqual(missingSteps(renamed), [
    {suite: step.suite, step: step.step, group: 'J12'},
    {suite: kept.suite, step: kept.step, group: 'kept'},
  ]);
});

// Why (1 Nov 2026, a8 brief): safety and data marks live in code; copying a flag here would drift from `{safety: true}`; lib/safety-steps.mjs is the one reader.
test('the registry copies no safety or data flag', () => {
  for (const entry of registrySteps(registry)) assert.deepEqual(Object.keys(entry).filter(key => !['suite', 'step', 'parts', 'group'].includes(key)), [], entry.step);
});

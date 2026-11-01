// The critical-journey registry (critical-journeys.json) names real steps, gives every journey a tier and copies no safety or data mark.
// Reaches: ../critical-journeys.json, ../lib/critical-journeys.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {ensureStaged} from '../../lib/ensure-staged.mjs';
import {journeySuites, loadJourneys, missingIntegrationTests, missingSteps, registrySteps} from '../../lib/critical-journeys.mjs';
import {SUITES} from '../../lib/context.mjs';

ensureStaged(fileURLToPath(new URL('../../..', import.meta.url)));
const registry = loadJourneys();

// Why (1 Nov 2026, owner via mac-07: "'Find jobs using your browser' this is not critical", "Move all 3 to integration"; owner: "We can build 10-20 more journeys. for the integrations", a8 yes via tj): J3 is out; the registry has J0-J2, J4-J12, the tier additions J13-J19 and J20-J39, Tier 2 journeys proved by integration files (J36-J39 each came with a new test).
test('the registry holds the journeys J0-J2, J4-J12, the tier additions J13-J19 and the integration journeys J20-J39, each with a name and steps', () => {
  assert.deepEqual(registry.journeys.map(journey => journey.id), ['J0', 'J1', 'J2', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9', 'J10', 'J11', 'J12', 'J13', 'J14', 'J15', 'J16', 'J17', 'J18', 'J19', 'J20', 'J21', 'J22', 'J23', 'J24', 'J25', 'J26', 'J27', 'J28', 'J29', 'J30', 'J31', 'J32', 'J33', 'J34', 'J35', 'J36', 'J37', 'J38', 'J39']);
  for (const journey of registry.journeys) {
    assert.ok(journey.name.length > 10, `${journey.id} has the owner's name`);
    assert.ok(journey.steps.length > 0, `${journey.id} has steps`);
  }
  assert.ok(!journeySuites(registry).includes('visitsauto'), 'J3 moved to integration: its suite holds no registry step');
  assert.ok(registry.kept.length > 0, 'the safety or data steps no journey owns are kept in their own group');
});

// Why (1 Nov 2026, owner via mac-07): tier 1 = "it blocks the user's flow", runs after every merge and blocks the beta; tier 2 = an integration test only (owner: "Only tier 1 … should stay e2e").
test('every journey has tier 1 or 2, and the owner\'s first-tier journeys are tier 1', () => {
  for (const journey of registry.journeys) assert.ok([1, 2].includes(journey.tier), `${journey.id} has a tier`);
  const tier = id => registry.journeys.find(journey => journey.id === id)?.tier;
  for (const id of ['J0', 'J1', 'J2', 'J4', 'J5', 'J6', 'J7', 'J12', 'J13', 'J14']) assert.equal(tier(id), 1, id);
  for (const id of ['J8', 'J9', 'J10', 'J11', 'J15', 'J16', 'J17', 'J18', 'J19', ...Array.from({length: 20}, (_, i) => `J${20 + i}`)]) assert.equal(tier(id), 2, id);
  assert.equal(tier('J8'), 2, 'Tailor CV: a failed tailor leaves the base CV, so it degrades but does not block');
});

// Why (1 Nov 2026, owner: "tier2 should not be part by beta" … "everything that's tier 2 should be dropped/converted to integrations" … "Only tier 1 … should stay e2e"): e2e (after merge, night burn-in, beta) keeps only tier 1 journeys.
test('no tier 2 journey keeps an e2e step, and every tier 1 step is an e2e step', () => {
  for (const journey of registry.journeys) for (const entry of journey.steps) {
    if (journey.tier === 2) assert.ok(entry.integration && entry.test && !entry.suite && !entry.step, `${journey.id} (tier 2) step must be {integration, test}: ${JSON.stringify(entry).slice(0, 120)}`);
    else assert.ok(entry.suite && entry.step && !entry.integration, `${journey.id} (tier 1) step must be {suite, step}: ${JSON.stringify(entry).slice(0, 120)}`);
  }
});

test('every tier 2 journey\'s integration test exists (a rename or a removal fails here)', () => {
  assert.deepEqual(missingIntegrationTests(registry), []);
  assert.ok(registrySteps(registry).some(entry => entry.integration), 'the control: the registry lists integration tests');
});

test('an integration step that lists literal parts is reported when one part is gone (a name the test builds from pieces)', () => {
  const edited = structuredClone(registry);
  const step = edited.journeys.find(journey => journey.id === 'J19').steps[0];
  assert.ok(step.parts?.length > 1, 'the control: J19 lists its title in parts');
  step.parts = [...step.parts, 'a part the test does not hold'];
  assert.deepEqual(missingIntegrationTests(edited).map(({group}) => group), ['J19']);
});

test('an integration test renamed in its file is reported with its group', () => {
  const renamed = structuredClone(registry);
  const step = renamed.journeys.find(journey => journey.id === 'J16').steps[0];
  step.test = `${step.test} (renamed)`;
  const gone = renamed.journeys.find(journey => journey.id === 'J17').steps[0];
  gone.integration = 'desktop/integration/app/no-such-file.test.js';
  assert.deepEqual(missingIntegrationTests(renamed), [{integration: step.integration, test: step.test, group: 'J16'}, {integration: gone.integration, test: gone.test, group: 'J17'}]);
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
  for (const entry of registrySteps(registry)) assert.deepEqual(Object.keys(entry).filter(key => !['suite', 'step', 'parts', 'group', 'integration', 'test'].includes(key)), [], entry.step ?? entry.test);
});

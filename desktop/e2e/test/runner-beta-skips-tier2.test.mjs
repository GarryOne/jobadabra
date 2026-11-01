// A beta runs no tier 2 step: a step the registry lists in a tier 2 journey is skipped (never failed) in a beta, and runs as today everywhere else (owner, 1 Nov 2026).
// Why (1 Nov 2026, owner: "tier2 should not be part by beta", "Only tier 1 ... should stay e2e"): beta by hand run 41275070968 (main d1495ce) failed focusdismiss's J19 step on its
// first try and on its beta retry; a tier 2 step stopped the release. The cases: (a) every tier 2 step is skipped in a beta, with the line, (b) the same steps run outside a beta,
// (c) a tier 1 step, a kept step and an unlisted step run in a beta, (d) a step whose value came from a skipped tier 2 step is skipped by its own `needs`, never failed.
// Job: report health
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRunner} from '../lib/runner.mjs';
import {BETA_RETRY} from '../lib/beta-retry.mjs';
import {isTier2Step, loadJourneys, registrySteps} from '../lib/critical-journeys.mjs';

const registry = loadJourneys();
const tier2 = registry.journeys.filter(journey => journey.tier === 2).flatMap(journey => journey.steps);
const tier1 = [...registry.journeys.filter(journey => journey.tier === 1).flatMap(journey => journey.steps), ...registry.kept];
// The step's real name: a step whose name the code builds lists literal `parts`; they are joined to a name that holds all of them.
const nameOf = entry => (entry.parts ? entry.parts.join(' ') : entry.step);

async function play(beta, suite, name, options = {}) {
  const before = process.env[BETA_RETRY], log = console.log, lines = [];
  if (beta) process.env[BETA_RETRY] = '1'; else delete process.env[BETA_RETRY];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const runner = createRunner(() => null, {suite, cadence: 'manual', keepGoing: true});
    let calls = 0;
    await runner.run(name, async () => { calls++; throw new Error('Timeout 30000ms'); }, options);
    return {result: runner.results[0], calls, lines};
  } finally {
    console.log = log;
    if (before === undefined) delete process.env[BETA_RETRY]; else process.env[BETA_RETRY] = before;
  }
}

test('the registry has tier 2 steps to skip, counted from the file', () => {
  assert.ok(tier2.length > 0, 'a tier 2 journey with steps');
  assert.equal(registrySteps(registry).filter(entry => entry.group !== 'kept').length, registry.journeys.reduce((sum, journey) => sum + journey.steps.length, 0));
});

test('(a) in a beta every tier 2 step is skipped, says why in one line, and is never run or failed', async () => {
  for (const entry of tier2) {
    const {result, calls, lines} = await play(true, entry.suite, nameOf(entry));
    assert.equal(calls, 0, `${entry.suite} · ${entry.step} did not run`);
    assert.equal(result.status, 'skipped', entry.step);
    assert.ok(lines.includes(`– ${nameOf(entry)}: not in the beta (tier 2: night and integration only)`), `${entry.step}: the line`);
  }
});

test('(a2) a tier 2 step marked safety or data still runs in a beta (the J8 Tailor CV write is a data step), once: no retry (Gitar on #2807)', async () => {
  for (const options of [{data: true}, {safety: true}]) {
    const {result, calls, lines} = await play(true, tier2[0].suite, nameOf(tier2[0]), options);
    assert.equal(calls, 1, JSON.stringify(options));
    assert.equal(result.status, 'failed');
    assert.ok(!lines.some(line => line.includes('not in the beta')));
  }
});

test('(b) outside a beta (PR, main, night, by hand) the same tier 2 steps run as today', async () => {
  for (const entry of tier2) {
    const {result, calls, lines} = await play(false, entry.suite, nameOf(entry));
    assert.equal(calls, 1, entry.step);
    assert.equal(result.status, 'failed', entry.step);
    assert.ok(!lines.some(line => line.includes('not in the beta')), entry.step);
  }
});

test('(c) in a beta a tier 1 step, a kept step and an unlisted step run (the first try, then the beta retry)', async () => {
  for (const entry of [tier1[0], registry.kept[0], {suite: 'wizard', step: 'a step no journey lists'}]) {
    const {result, calls} = await play(true, entry.suite, nameOf(entry));
    assert.equal(calls, 2, entry.step);
    assert.equal(result.status, 'failed', entry.step);
  }
});

test('a tier 2 step in a suite that does not hold it runs: the registry names suite and step together', () => {
  const entry = tier2[0];
  assert.equal(isTier2Step(entry.suite, nameOf(entry)), true);
  assert.equal(isTier2Step('no-such-suite', nameOf(entry)), false);
  assert.equal(isTier2Step(entry.suite, 'another step'), false);
});

test('(d) a step that needs a value only a skipped tier 2 step makes is skipped by its needs, not failed', async () => {
  const before = process.env[BETA_RETRY], log = console.log;
  process.env[BETA_RETRY] = '1';
  console.log = () => {};
  try {
    const entry = tier2[0], made = {name: 'the tailored CV', value: null};
    const runner = createRunner(() => null, {suite: entry.suite, cadence: 'manual', keepGoing: true});
    await runner.run(nameOf(entry), async () => { made.value = 'cv.pdf'; });
    await runner.run('uses the tailored CV', async () => { throw new Error('must not run'); }, {needs: [made]});
    assert.deepEqual(runner.results.map(result => result.status), ['skipped', 'skipped']);
  } finally {
    console.log = log;
    if (before === undefined) delete process.env[BETA_RETRY]; else process.env[BETA_RETRY] = before;
  }
});

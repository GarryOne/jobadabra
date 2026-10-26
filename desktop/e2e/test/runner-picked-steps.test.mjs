// A pull request runs only the steps its changed lines reach (E2E_STEP_NAMES, from pr-suites.mjs), their stepNeeds and the critical setup; a picked name that no step has
// fails the suite so the second try runs it whole; each step's coverage is read at its start (setup) and end (the step). Owner, 26 Oct 2026: "Or not even an entire e2e
// suite, but just few tests/scenarios/cases from that suite".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRunner, pickedNames, PICK_SETUP} from '../lib/runner.mjs';

async function suite(names, {stepNeeds = {}} = {}) {
  const before = process.env.E2E_STEP_NAMES;
  process.env.E2E_STEP_NAMES = JSON.stringify(names);
  try {
    const marks = [];
    const session = {coverageMark: async () => marks.push('mark'), coverageStep: async name => marks.push(`step:${name}`)};
    const runner = createRunner(() => session, {keepGoing: true, stepNeeds});
    const ran = [];
    await runner.run('Launch the app, with a comma', async () => { ran.push('launch'); }, {critical: true});
    await runner.run('Open Settings', async () => { ran.push('settings'); });
    await runner.run('Export the profile, with profile.md', async () => { ran.push('export'); });
    await runner.run('Jobs list shows one row', async () => { ran.push('jobs'); });
    return {ran, code: runner.summary(), results: runner.results, marks};
  } finally { if (before === undefined) delete process.env.E2E_STEP_NAMES; else process.env.E2E_STEP_NAMES = before; }
}

test('only the picked steps run (exact names, commas allowed), plus the critical setup', async () => {
  const {ran, code} = await suite(['Export the profile, with profile.md']);
  assert.deepEqual(ran, ['launch', 'export']);
  assert.equal(code, 0);
});

test("a picked step's declared needs run too", async () => {
  const {ran} = await suite(['Export the profile, with profile.md'], {stepNeeds: {export: ['open settings']}});
  assert.deepEqual(ran, ['launch', 'settings', 'export']);
});

test('"(setup)" alone runs only the critical setup', async () => {
  assert.deepEqual((await suite([PICK_SETUP])).ran, ['launch']);
});

test('a picked name no step has fails the suite (the whole suite runs on the second try), never a quiet green', async () => {
  const {ran, code, results} = await suite(['Export the profile (renamed since)']);
  assert.deepEqual(ran, ['launch']);
  assert.equal(code, 1);
  assert.match(results.at(-1).note, /renamed since the coverage map was recorded/);
});

test('no pick: every step runs, as before', async () => {
  assert.deepEqual((await suite([])).ran, ['launch', 'settings', 'export', 'jobs']);
  assert.deepEqual(pickedNames({E2E_STEP_NAMES: 'not json'}), []);
});

test("coverage is read at each run step's start and end, so a step's lines are its own", async () => {
  const {marks} = await suite(['Open Settings']);
  assert.deepEqual(marks, ['mark', 'step:Launch the app, with a comma', 'mark', 'step:Open Settings']);
});

// A step-sharded suite (apply, applyflows) runs a picked step in ONE slice; the other slice leaves it (`elsewhere`) and must not call it missing: before 26 Oct 2026 the
// slice without the step went red ("no step is named …") and its second try ran the whole suite.
test('a picked step another slice runs counts as found: the slice without it stays green and runs only the setup', async () => {
  const before = process.env.E2E_STEP_NAMES;
  process.env.E2E_STEP_NAMES = JSON.stringify(['Export the profile, with profile.md']);
  try {
    const runner = createRunner(() => ({}), {keepGoing: true}), ran = [];
    await runner.run('Launch the app, with a comma', async () => { ran.push('launch'); }, {critical: true});
    await runner.run('Export the profile, with profile.md', async () => { ran.push('export'); }, {elsewhere: true});
    assert.deepEqual(ran, ['launch']);
    assert.equal(runner.summary(), 0);
  } finally { if (before === undefined) delete process.env.E2E_STEP_NAMES; else process.env.E2E_STEP_NAMES = before; }
});

// A suite that declares no stepNeeds (null): its steps may build on every earlier one, so a picked step runs after all the steps before it and only the steps after
// the last picked one are skipped (#2108, 26 Oct 2026: quality's picked "a Jobs check on the golden postings" ran without the step that loads those postings and
// found no rows). A suite that declares stepNeeds (even {}) keeps the precise pick above.
test('no stepNeeds declared: a picked step runs with every step before it; the steps after the last picked one are skipped', async () => {
  const {ran, code} = await suite(['Export the profile, with profile.md'], {stepNeeds: null});
  assert.deepEqual(ran, ['launch', 'settings', 'export']);
  assert.equal(code, 0);
  assert.deepEqual((await suite(['Open Settings'], {stepNeeds: null})).ran, ['launch', 'settings']);
  assert.deepEqual((await suite([PICK_SETUP], {stepNeeds: null})).ran, ['launch'], '"(setup)" alone: still only the critical setup');
  assert.deepEqual((await suite([], {stepNeeds: null})).ran, ['launch', 'settings', 'export', 'jobs'], 'no pick: every step');
});

test('no stepNeeds declared and a picked name no step has: every step runs, and the suite still fails for the lost name', async () => {
  const {ran, code} = await suite(['Export the profile (renamed since)'], {stepNeeds: null});
  assert.deepEqual(ran, ['launch', 'settings', 'export', 'jobs']);
  assert.equal(code, 1);
});

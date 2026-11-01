// The step slices of apply and applyflows (lib/step-slices.mjs): every step runs in exactly one slice, a step runs where the step it needs ran, every forms and CV step
// of apply is weighed, and apply's slices are near equal (26 Oct 2026: one job took 6-6.5 of its 7 minutes; turn-taking would have put 349 s in one half).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {stepSlicer} from '../lib/step-slices.mjs';
import * as apply from '../suites/apply.mjs';
import * as flows from '../suites/applyflows.mjs';
import {loadCases} from '../lib/page-replay.mjs';
import {costOf, shardOf, weighedSlices} from '../lib/replay-shard.mjs';

const measured = JSON.parse(fs.readFileSync(new URL('../fixtures/slice-ci-seconds.json', import.meta.url), 'utf8'));
const SETUP = 'the app has an applicant';
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const names = text => [...text.matchAll(/ctx\.run\('((?:[^'\\]|\\.)*)'/g)].map(match => match[1].replace(/\\'/g, "'"));
// apply's steps in the order runApply meets them: its own, with the journeys, the CV steps and the silent-Chrome steps where it calls them.
const ORDER = (() => {
  const own = read('suites/apply.mjs'), journeys = own.indexOf('await runJourneys('), cvAt = own.indexOf('await runCvSteps(');
  assert.ok(journeys > 0 && cvAt > journeys, 'runApply calls the journeys, then the CV steps');
  return [...names(own.slice(0, journeys)), ...names(read('lib/apply-journeys.mjs')), ...names(own.slice(journeys, cvAt)), ...names(read('lib/apply-cv-steps.mjs')), ...names(read('lib/apply-silent-steps.mjs')), ...names(read('lib/apply-triage-steps.mjs')), ...names(read('lib/apply-triage-cancel-steps.mjs')), ...names(read('lib/apply-restart-steps.mjs')), ...names(read('lib/apply-stop-steps.mjs')), ...names(read('lib/apply-confirm-steps.mjs')), ...names(own.slice(cvAt))];
})();
const stepsOf = parts => ORDER.filter(name => parts.includes(apply.partOf(name)));
const needsOf = name => Object.entries(apply.stepNeeds).filter(([word]) => name.includes(word)).flatMap(([, list]) => list).filter(word => word !== SETUP);
const SUITES = {apply: {parts: ['forms', 'cv'], seconds: apply.stepSeconds}, applyflows: {parts: ['flows'], seconds: apply.flowSeconds}};

test('every sliced step of apply and applyflows runs in exactly one slice, and where the step it needs runs', async () => {
  for (const [suite, {parts, seconds}] of Object.entries(SUITES)) {
    const {shards} = await import(`../suites/${suite}.mjs`), steps = stepsOf(parts);
    assert.equal(shards, {apply: 3, applyflows: 3}[suite], suite);
    assert.ok(steps.length >= 3, `${suite}: only ${steps.length} steps read: the pattern no longer matches`);
    const runs = Array.from({length: shards}, (_, at) => { const takes = stepSlicer({index: at + 1, count: shards}, {seconds, needs: apply.stepNeeds, setup: SETUP}); return steps.filter(name => takes(name)); });
    for (const name of steps) assert.equal(runs.filter(list => list.includes(name)).length, 1, `${suite}: "${name.slice(0, 60)}" runs in ${runs.filter(list => list.includes(name)).length} slices`);
    for (const list of runs) for (const name of list) for (const word of needsOf(name)) assert.ok(list.some(other => other !== name && other.includes(word)), `${suite}: "${name.slice(0, 50)}" runs without "${word}" in its slice`);
  }
});

test('every forms and CV step of apply is weighed or follows one, and no weight names a gone step', () => {
  const steps = stepsOf(['forms', 'cv']), heads = Object.keys(apply.stepSeconds);
  assert.deepEqual(steps.filter(name => !heads.some(head => name.startsWith(head)) && !needsOf(name).length), [], 'weigh the new step in suites/apply.mjs stepSeconds');
  assert.deepEqual(heads.filter(head => !steps.some(name => name.startsWith(head))), []);
});

// Why (31 Oct 2026, owner chose "Split apply first"; 1 Nov 2026 no step reads another's tab any more): the apply suite is cut in three so each slice stays well under the 11-minute budget; every third must carry close to a third of the weighed seconds.
test('apply\'s three slices are within a tenth of each other', () => {
  const owner = weighedSlices(apply.stepSeconds, apply.shards), load = [1, 2, 3].map(index => Object.entries(apply.stepSeconds).filter(([head]) => owner[head] === index).reduce((sum, [, s]) => sum + s, 0));
  const mean = load.reduce((sum, s) => sum + s, 0) / load.length;
  assert.equal(apply.shards, 3);
  assert.ok((Math.max(...load) - Math.min(...load)) / mean < 0.1, `slices ${load.join(' vs ')} s`);
});

test('without a slice every step runs; a step nobody weighed takes turns', () => {
  assert.equal(stepSlicer(null)('anything'), true);
  const first = stepSlicer({index: 1, count: 2}), second = stepSlicer({index: 1, count: 2});
  assert.deepEqual(['a', 'b', 'c'].map(first), [true, false, true]);
  assert.deepEqual(['a', 'b', 'c'].map(second), [true, false, true]);
});

// 26 Oct 2026, beta 40275152602: applyflows took turns, one slice drew the heavy journeys and ran out of its 7 minutes; it is weighed like apply now.
test('every journey of applyflows is weighed or follows one, and no weight names a gone step', () => {
  const steps = stepsOf(['flows']), heads = Object.keys(apply.flowSeconds);
  assert.deepEqual(steps.filter(name => !heads.some(head => name.startsWith(head)) && !needsOf(name).length), [], 'weigh the new journey in suites/apply.mjs flowSeconds');
  assert.deepEqual(heads.filter(head => !steps.some(name => name.startsWith(head))), []);
  for (const name of steps) assert.ok(heads.filter(head => name.startsWith(head)).length <= 1, `"${name.slice(0, 50)}" matches two weights`);
  // Why (1 Nov 2026, R3): three journeys are left (the others went to recorded pages and integration), 218 s in all; three steps over flows.shards = 3 slices land one per slice (97 vs 58 s) and cannot be balanced to a tenth, so the capacity test below is what the budget needs.
});

// Pinned observations supply the weights; these guards check placement and capacity, while the PR run proves current runtime.
test('applyflows slices fit eight measured minutes', () => {
  for (let index = 1; index <= flows.shards; index++) {
    const takes = stepSlicer({index, count: flows.shards}, {seconds: apply.flowSeconds, needs: apply.stepNeeds, setup: SETUP});
    const load = stepsOf(['flows']).filter(name => takes(name)).reduce((sum, name) => sum + (Object.entries(measured.applyflows).find(([head]) => name.startsWith(head))?.[1] || 0), 0);
    assert.ok(load <= 480, `applyflows ${index}/${flows.shards}: ${load} measured seconds exceeds eight minutes`);
  }
});

// The recorded cases are no e2e suite since 1 Nov 2026: CI · Integration · Page cases (page-cases.yml, JP_REPLAY_SHARD_COUNT slices) is their only home.
test('recorded case slices of page-cases.yml run each case once and balance measured seconds', () => {
  const count = Number(/JP_REPLAY_SHARD_COUNT: (\d+)/.exec(fs.readFileSync(new URL('../../../.github/workflows/page-cases.yml', import.meta.url), 'utf8'))?.[1]);
  assert.ok(count >= 1, 'page-cases.yml names its slice count');
  const cases = loadCases();
  const slices = Array.from({length: count}, (_, at) => shardOf(cases, at + 1, count));
  assert.deepEqual(slices.flat().map(item => item.name).sort(), cases.map(item => item.name).sort(), 'each case runs once');
  const load = slices.map(slice => slice.reduce((sum, item) => sum + (measured.recorded[item.name] ?? costOf(item, measured.recorded)), 0));
  const mean = load.reduce((sum, seconds) => sum + seconds, 0) / load.length;
  assert.ok((Math.max(...load) - Math.min(...load)) / mean < 0.1, `recorded slices ${load.join(' vs ')} measured seconds`);
});

// The step slices of apply and applyflows (lib/step-slices.mjs): every step runs in exactly one slice, a step runs where the step it needs ran, every forms and CV step
// of apply is weighed, and apply's halves are near equal (26 Oct 2026: one job took 6-6.5 of its 7 minutes; turn-taking would have put 349 s in one half).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {stepSlicer, weighedSlices} from '../lib/step-slices.mjs';
import * as apply from '../suites/apply.mjs';

const SETUP = 'the app has an applicant';
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const names = text => [...text.matchAll(/ctx\.run\('((?:[^'\\]|\\.)*)'/g)].map(match => match[1].replace(/\\'/g, "'"));
// apply's steps in the order runApply meets them: its own, with the journeys and the CV steps where it calls them.
const ORDER = (() => {
  const own = read('suites/apply.mjs'), journeys = own.indexOf('await runJourneys('), cvAt = own.indexOf('await runCvSteps(');
  assert.ok(journeys > 0 && cvAt > journeys, 'runApply calls the journeys, then the CV steps');
  return [...names(own.slice(0, journeys)), ...names(read('lib/apply-journeys.mjs')), ...names(own.slice(journeys, cvAt)), ...names(read('lib/apply-cv-steps.mjs')), ...names(own.slice(cvAt))];
})();
const stepsOf = parts => ORDER.filter(name => parts.includes(apply.partOf(name)));
const needsOf = name => Object.entries(apply.stepNeeds).filter(([word]) => name.includes(word)).flatMap(([, list]) => list).filter(word => word !== SETUP);
const SUITES = {apply: {parts: ['forms', 'cv'], seconds: apply.stepSeconds}, applyflows: {parts: ['flows'], seconds: {}}};

test('every sliced step of apply and applyflows runs in exactly one slice, and where the step it needs runs', async () => {
  for (const [suite, {parts, seconds}] of Object.entries(SUITES)) {
    const {shards} = await import(`../suites/${suite}.mjs`), steps = stepsOf(parts);
    assert.equal(shards, 2, suite);
    assert.ok(steps.length >= 10, `${suite}: only ${steps.length} steps read: the pattern no longer matches`);
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

test('apply\'s two halves are within a tenth of each other, and the hidden need of "Ready to submit" is said', () => {
  const owner = weighedSlices(apply.stepSeconds, 2), load = [1, 2].map(index => Object.entries(apply.stepSeconds).filter(([head]) => owner[head] === index).reduce((sum, [, s]) => sum + s, 0));
  assert.ok(Math.abs(load[0] - load[1]) / (load[0] + load[1]) < 0.1, `halves ${load.join(' vs ')} s`);
  assert.ok(apply.stepNeeds['Ready to submit']?.includes('cannot operate'), 'it reads the tab the "cannot operate" step left');
});

test('without a slice every step runs; a step nobody weighed takes turns', () => {
  assert.equal(stepSlicer(null)('anything'), true);
  const first = stepSlicer({index: 1, count: 2}), second = stepSlicer({index: 1, count: 2});
  assert.deepEqual(['a', 'b', 'c'].map(first), [true, false, true]);
  assert.deepEqual(['a', 'b', 'c'].map(second), [true, false, true]);
});

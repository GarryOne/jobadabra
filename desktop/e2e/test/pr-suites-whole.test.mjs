// A pull request runs every e2e suite it picks whole, never a step alone (owner, 28 Oct 2026: a suite is a journey; lib/pr-suites.mjs stepLists).
// Plays #2342: its change sat inside focus's "Edit target" step; the PR ran that step alone, it found no target (the step before it adds one) and went red.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stepLists} from '../lib/pr-suites.mjs';

// What pr-suites.mjs found for #2342: focus's own file changed inside one named step, and the coverage map's lines reached it too.
const pr2342 = {suites: ['focus'], own: {focus: ['Edit target']}, picked: {focus: {reason: 'runs desktop/renderer/pages/focus.js'}}, byLines: {focus: ['Edit target']}};

test('#2342 on a pull request: focus runs whole, with no step names (E2E_STEP_NAMES stays empty)', () => {
  assert.deepEqual(stepLists({...pr2342, pullRequest: true}), {});
});

test('after a merge (main-steps.yml) the same change still runs only the steps it reaches', () => {
  assert.deepEqual(stepLists(pr2342), {focus: ['Edit target']});
});

test('a removed quote inside a step, on a pull request: still the whole suite', () => {
  const quoting = {settings: {steps: ['Automatic backup'], whole: false}};
  assert.deepEqual(stepLists({suites: ['settings'], quoting, pullRequest: true}), {});
  assert.deepEqual(stepLists({suites: ['settings'], quoting}), {settings: ['Automatic backup']});
});

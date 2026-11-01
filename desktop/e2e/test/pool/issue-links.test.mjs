// A push that changes an e2e suite names its open failed-step issues (#310, #315 were fixed in the test by commits that never named them).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openFailures, suitesOf, unnamed} from '../../lib/issue-links.mjs';

const suites = {
  activityfailures: "import {openContext} from '../../lib/context.mjs';",
  failureschannels: "import {runParts} from '../activityfailures.mjs';\nimport {openContext} from '../../lib/context.mjs';",
  activity: "import {openRun} from '../../lib/activity-steps.mjs';\nimport {openContext} from '../../lib/context.mjs';",
  focus: "import {seed} from '../../lib/focus-data.mjs';\nimport {openContext} from '../../lib/context.mjs';",
  jobs: "import {openContext} from '../../lib/context.mjs';",
};
const issue = (number, suite, kind = 'test-failure') => ({number, title: `[auto-ui] ${suite}: step failed`, labels: [{name: 'auto-ui'}, {name: `kind:${kind}`}, {name: `suite:${suite}`}]});

test('a suite file is itself and the suites that run its steps; a helper counts only when few suites use it', () => {
  assert.deepEqual(suitesOf(['desktop/e2e/suites/activityfailures.mjs'], suites), ['activityfailures', 'failureschannels']);
  assert.deepEqual(suitesOf(['desktop/e2e/lib/activity-steps.mjs'], suites), ['activity'], '5b29659, the fix of #310');
  assert.deepEqual(suitesOf(['desktop/e2e/lib/context.mjs'], suites), [], 'shared plumbing answers no one suite');
  assert.deepEqual(suitesOf(['desktop/e2e/README.md'], suites), []);
});

test('an open failed-step issue of a touched suite must be named, or the push says why none is', () => {
  const issues = [issue(315, 'focus'), issue(310, 'activity'), issue(309, 'jobs', 'empty-state')];
  const failures = openFailures(issues, ['focus', 'jobs']);
  assert.deepEqual(failures.map(item => item.number), [315], 'only failed steps, only these suites');
  assert.deepEqual(unnamed(failures, ['E2E focus: after the hold, re-read Notion for 90 s']).map(item => item.number), [315], '9781266 as it was pushed');
  assert.deepEqual(unnamed(failures, ['E2E focus: re-read Notion\n\nFixes #315']), []);
  assert.deepEqual(unnamed(failures, ['x\n\nRefs #315']), []);
  assert.deepEqual(unnamed(failures, ['x\n\nE2E-issue: none a new step, no failure of it is open']), []);
  assert.deepEqual(unnamed(failures, ['x\n\nE2E-issue: none']).map(item => item.number), [315], 'a reason is required');
  assert.deepEqual(unnamed(failures, ['fixes #3150']).map(item => item.number), [315], 'another number is not this one');
});

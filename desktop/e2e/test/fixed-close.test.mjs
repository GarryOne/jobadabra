// A Finder issue closed by a fix ("Fixes #N" in a commit or a merged pull request) is counted as a real bug, fixed (12 Oct 2026: #360 and #400 were not).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {labelsForClose} from '../lib/fixed-close.mjs';

const commit = {__typename: 'Commit', oid: '534cf0e0000000000000000000000000000000000', url: 'https://github.com/o/r/commit/534cf0e'};
const merged = {__typename: 'PullRequest', number: 465, merged: true, url: 'https://github.com/o/r/pull/465'};

test('closed by a commit or a merged pull request, with no resolution yet: confirmed and resolution:fixed', () => {
  const cases = [
    // [what, issue, expected labels or null]
    ['#360: closed by its fix commit', {labels: ['auto-ui', 'needs-human'], stateReason: 'COMPLETED', closer: commit}, ['confirmed', 'resolution:fixed']],
    ['#400: closed by its fix commit, already confirmed', {labels: ['auto-ui', 'confirmed'], stateReason: 'COMPLETED', closer: commit}, ['resolution:fixed']],
    ['closed by a merged pull request', {labels: ['auto-ui'], stateReason: 'COMPLETED', closer: merged}, ['confirmed', 'resolution:fixed']],
    ['a verdict already said why (apply-verdict.sh labels before it closes)', {labels: ['auto-ui', 'resolution:fp:detector'], stateReason: 'COMPLETED', closer: commit}, null],
    ['closed as not planned', {labels: ['auto-ui'], stateReason: 'NOT_PLANNED', closer: commit}, null],
    ['closed by hand, no fix named', {labels: ['auto-ui'], stateReason: 'COMPLETED', closer: null}, null],
    ['a pull request that was not merged', {labels: ['auto-ui'], stateReason: 'COMPLETED', closer: {...merged, merged: false}}, null],
    ['not a Finder issue (a person\'s: tracker-sync.yml handles it)', {labels: ['bug'], stateReason: 'COMPLETED', closer: commit}, null],
  ];
  for (const [what, issue, expected] of cases) assert.deepEqual(labelsForClose(issue)?.add ?? null, expected, what);
});

// A fix that changed only tests or docs proves neither way: #350 was a test mistake, but #400's test commit closed a real bug whose product fix (e61e334)
// had landed earlier without naming it. Such a closure is left for a verdict (needs-human), never counted as real or false by the rule.
test('a fix that changed only tests or docs is left for a verdict, never counted as fixed (#350 was labelled fixed by mistake, 12 Oct 2026)', () => {
  const issue = files => ({labels: ['auto-ui'], stateReason: 'COMPLETED', closer: merged, files});
  const cases = [
    ['#350: the quality judge step and its test', ['desktop/e2e/suites/quality.mjs', 'desktop/e2e/test/quality-judge-input.test.mjs'], ['needs-human']],
    ['#400: the calendar step only (the product fix was another commit)', ['desktop/e2e/suites/calendar.mjs'], ['needs-human']],
    ['a test plus a doc', ['tests/test_x.py', 'docs/ARCHITECTURE.md', 'desktop/test/a.test.js'], ['needs-human']],
    ['#409: product code and its test', ['desktop/renderer/pages/core.js', 'desktop/test/message-plain-error.test.js'], ['confirmed', 'resolution:fixed']],
    ['the engine', ['src/stores/notion.py', 'tests/test_y.py'], ['confirmed', 'resolution:fixed']],
    ['files unknown: the old answer', undefined, ['confirmed', 'resolution:fixed']],
  ];
  for (const [what, files, expected] of cases) assert.deepEqual(labelsForClose(issue(files))?.add ?? null, expected, what);
  assert.match(labelsForClose(issue(['desktop/e2e/suites/quality.mjs'])).comment, /only tests or docs/);
});

test('the comment names the fix', () => {
  assert.match(labelsForClose({labels: ['auto-ui'], stateReason: 'COMPLETED', closer: commit}).comment, /534cf0e/);
  assert.match(labelsForClose({labels: ['auto-ui'], stateReason: 'COMPLETED', closer: merged}).comment, /#465/);
});

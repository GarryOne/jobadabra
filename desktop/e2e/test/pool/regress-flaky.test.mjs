// A defect a fix closed that comes back is a regression (P1 at least); a failed step whose suite passed on the same commit is flaky (P3, the test's fault).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {closedByFix, failedCommits, fixedBefore, flakyOn, priorityOf} from '../../lib/triage.mjs';

const finding = {id: 'jobs-functionality-x', view: 'jobs', kind: 'functionality', title: 'Retry offered though it cannot work', detail: 'Retry shows while no AI key is saved'};
const closed = (reason, comment, extra = {}) => ({number: 171, state: 'CLOSED', stateReason: reason, title: '[auto-ui] jobs: Retry offered though it cannot succeed',
  body: '🟠 **MEDIUM** · functionality · found by the AI screenshot review\n\n### What was found\nRetry shows while no AI key is saved, it cannot work\n', labels: [{name: 'auto-ui'}], comments: [{body: comment}], ...extra});

test('only an issue a FIX closed makes a regression; one closed as not seen or rejected does not', () => {
  const fixed = closed('COMPLETED', 'Fixed by https://github.com/o/r/pull/9 (merged by the UI loop).');
  assert.ok(closedByFix(fixed));
  assert.equal(fixedBefore(finding, [fixed])?.number, 171);
  assert.equal(fixedBefore(finding, [closed('COMPLETED', 'Not seen in two runs in a row: closed.')]), null);
  assert.equal(fixedBefore(finding, [closed('NOT_PLANNED', 'Fixed by https://x')]), null);
  assert.ok(closedByFix(closed('COMPLETED', 'Closed: commit abc1234 says it fixes this, and the latest run did not see it.')));
});

test('a regression is P1 at least; a flaky step is P3 whatever its score', () => {
  const issue = labels => ({state: 'OPEN', body: '🟠 **MEDIUM** · functionality · x\n\nBuild tested: main @ abc1234', labels: labels.map(name => ({name})), comments: []});
  assert.equal(priorityOf(issue([])), 'P3');
  assert.equal(priorityOf(issue(['regression'])), 'P1');
  assert.equal(priorityOf(issue(['flaky', 'confirmed'])), 'P3');
});

test('flaky: the step failed on this very commit (body or a Seen again), and only a failed-step issue', () => {
  const failed = {body: '🟠 **MEDIUM** · test-failure · found by a run of the focus suite\n> 🏷️ Build tested: main @ abc1234 (schedule run)', comments: [{body: 'Seen again in run 9.\nBuild tested: main @ def5678 (schedule run)'}]};
  assert.deepEqual([...failedCommits(failed)].sort(), ['abc1234', 'def5678']);
  assert.ok(flakyOn(failed, 'def5678'));
  assert.ok(!flakyOn(failed, '9999999'), 'a pass on a newer commit is a fix, not a flake');
  assert.ok(!flakyOn({...failed, body: failed.body.replace('test-failure', 'layout')}, 'abc1234'));
});

test('an issue closed with resolution:fixed counts as closed by a fix, whatever its comment says; one closed as not planned never does', () => {
  const issue = (stateReason, labels) => ({state: 'CLOSED', stateReason, labels: labels.map(name => ({name})), comments: [{body: '<!-- ui-loop-verdict:fixed -->'}]});
  assert.ok(closedByFix(issue('COMPLETED', ['auto-ui', 'resolution:fixed'])));
  assert.ok(!closedByFix(issue('COMPLETED', ['auto-ui'])));
  assert.ok(!closedByFix(issue('NOT_PLANNED', ['resolution:fixed'])));
});

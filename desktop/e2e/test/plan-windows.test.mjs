// The Windows e2e is started by the Mac run when it tested something: the same suites, the AI review as on the Mac, and a commit Windows already tested is not run again.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {macRunTitle, macSuites, plan, testedBefore} from '../plan-windows.mjs';

const job = (name, conclusion = 'success') => ({name, conclusion});

test('the suites that ran on the Mac run on Windows; skipped ones and the plan, promote and Windows jobs do not', () => {
  const jobs = [job('plan'), job('jobs'), job('quality', 'failure'), job('apply', 'skipped'), job('promote', 'skipped'), job('Windows follows', 'in_progress')];
  assert.deepEqual(macSuites(jobs), ['jobs', 'quality']);
  assert.deepEqual(plan({mac: {jobs}, sha: 'abc', review: true}), {suites: ['jobs', 'quality'], review: true});
});

test("the Mac run's other jobs are not suites: only suites that exist are planned (26 Oct 2026: HTML report and Telegram alert were)", () => {
  const jobs = [job('jobs'), job('HTML report'), job('Telegram alert'), job('Code → suite map'), job('Nothing tested', 'skipped'), job('recorded-2of5')];
  assert.deepEqual(macSuites(jobs, ['jobs', 'recorded', 'wander']), ['jobs', 'recorded']);
  assert.deepEqual(plan({mac: {jobs}, all: ['jobs', 'recorded'], sha: 'abc'}).suites, ['jobs', 'recorded']);
});

test('a commit Windows already tested is not run again; a cancelled or empty earlier run does not count', () => {
  const runs = [{id: 1, title: macRunTitle('abc'), conclusion: 'success', suitesRan: 13}, {id: 2, title: macRunTitle('abc'), conclusion: 'cancelled', suitesRan: 5},
    {id: 3, title: macRunTitle('abc'), conclusion: 'success', suitesRan: 0}, {id: 4, title: macRunTitle('def'), conclusion: 'success', suitesRan: 13}];
  assert.deepEqual(testedBefore(runs, 'abc', 9).map(run => run.id), [1]);
  assert.deepEqual(testedBefore(runs, 'xyz', 9), []);
  const skipped = plan({mac: {jobs: [job('jobs')]}, sha: 'abcdef123', previous: [{id: 1}]});
  assert.deepEqual(skipped.suites, []);
  assert.match(skipped.why, /already tested on Windows \(run 1\)/);
});

test("the title matched is the one e2e-windows.yml's run-name gives a run after a Mac run", () => {
  const runName = fs.readFileSync(new URL('../../../.github/workflows/e2e-windows.yml', import.meta.url), 'utf8').match(/^run-name: (.*)$/m)[1];
  assert.match(runName, /format\('E2E Windows · \{0\} · \{1\}'/);
  assert.match(runName, /inputs\.mac_run && 'the Mac run''s suites'/);
  assert.match(runName, /inputs\.sha \|\| github\.ref_name/);
  assert.equal(macRunTitle('abc'), "E2E Windows · the Mac run's suites · abc");
});

test('a run by hand takes the named suites, or every suite', () => {
  assert.deepEqual(plan({only: 'jobs, focus', all: ['a']}).suites, ['jobs', 'focus']);
  assert.equal(plan({only: 'jobs'}).review, false, 'by hand: no review unless asked');
  assert.equal(plan({only: 'jobs', review: true}).review, true, "the release run's Windows gate: the Mac + Linux gate's review");
  assert.deepEqual(plan({all: ['a', 'b']}).suites, ['a', 'b']);
});

// The night burn-in's pass: the beta's own layout on the commit of pass 1, with no paid model and no release steps (lib/night-pass.mjs, plan-run.mjs NIGHT_PASS).
// Why (31 Oct 2026, owner: "I want predictability. If a test was green last time, it should be green this time as well, if the code didn't change on that area."): five looks at one tree,
// at different hours, on the layout a beta runs. gh is a stub: no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import {nightRef, nightSuites, passNumber} from '../lib/night-pass.mjs';
import {planRun} from '../plan-run.mjs';

const HEAD = 'a'.repeat(40), FIRST = 'b'.repeat(40);
const ALL = ['jobs', 'settings', 'qualityai', 'notion-real', 'pool'];
const CADENCE = {qualityai: 'nightly', 'notion-real': 'night-report', pool: 'manual'};
const NOW = Date.parse('2026-11-01T01:30:00Z');

function gh({runs = [], releasing = []} = {}) {
  return args => {
    const text = args.join(' ');
    if (args[0] === 'run' && args[1] === 'list' && args.includes('desktop.yml')) return JSON.stringify(releasing);
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify(runs);
    if (args[0] === 'api' && /commits\//.test(text)) return text.match(/commits\/(\w+)/)[1];
    throw new Error(`unexpected gh call: ${text}`);
  };
}
const pass1 = {displayTitle: 'Night burn-in 1/5 · bbbbbbbb', headSha: FIRST, createdAt: '2026-10-31T21:00:08Z'};
const plan = (pass, stub, extra = {}) => planRun({env: {EVENT: 'workflow_dispatch', REPO: 'o/r', SHA: HEAD, NIGHT_PASS: pass, ...extra}, gh: gh(stub), all: ALL, minutes: () => 15, cadence: CADENCE});

test('a pass is n/5 and nothing else', () => {
  assert.deepEqual(['1/5', '5/5', ' 3/5 ', '0/5', '6/5', '3/4', '', undefined, 'x'].map(passNumber), [1, 5, 3, 0, 0, 0, 0, 0, 0]);
});

test('pass 1 tests the head it started on; a later pass tests the commit of the night\'s pass 1', () => {
  assert.equal(nightRef({pass: '1/5', sha: HEAD, now: NOW}).ref, HEAD);
  assert.equal(nightRef({pass: '3/5', sha: HEAD, runs: [{displayTitle: 'E2E for PR · jobs · x', headSha: 'c'.repeat(40), createdAt: '2026-10-31T23:00:00Z'}, pass1], now: NOW}).ref, FIRST);
});

test('a pass 1 from a previous night, or none at all, is not the commit: the pass tests its own head and says so', () => {
  const yesterday = {...pass1, createdAt: '2026-10-30T21:00:08Z'};
  for (const runs of [[], [yesterday]]) {
    const found = nightRef({pass: '4/5', sha: HEAD, runs, now: NOW});
    assert.equal(found.ref, HEAD);
    assert.match(found.why, /pass 1 of this night was not found/);
  }
  assert.throws(() => nightRef({pass: '9/5', sha: HEAD, now: NOW}), /not n\/5/);
});

test('a pass runs the gate\'s suites except the ones that ask the model live, the outside world and the manual ones', () => {
  assert.deepEqual(nightSuites(ALL, CADENCE), ['jobs', 'settings']);
});

test('the plan is the beta\'s layout: both stores for a suite that keeps data, no tag to approve, no AI review, the commit of pass 1', async () => {
  const out = await plan('3/5', {runs: [pass1]});
  const legs = JSON.parse(out.matrix).include;
  assert.equal(out.suites, 'jobs,settings');
  assert.deepEqual(legs.filter(leg => leg.suite === 'jobs').map(leg => leg.store).sort(), ['sqlite', 'standin']);
  assert.equal(out.tag, '', 'nothing to approve: a pass is not a release');
  assert.equal(out.review, '0');
  assert.equal(out.ref, FIRST);
  assert.match(out.why, /pass 3 tests pass 1's commit bbbbbbbb/);
});

test('a release run that is testing owns the suites\' groups: the pass skips itself and says why', async () => {
  const out = await plan('2/5', {runs: [pass1], releasing: [{status: 'in_progress', displayTitle: 'Nightly beta'}]});
  assert.equal(out.count, '0');
  assert.match(out.why, /Night burn-in 2\/5 skipped: a release run is testing \(Nightly beta\)/);
});

test('a night pass is not a look at its commit: the next main check still plans every suite for that commit', async () => {
  const onHead = displayTitle => ({event: 'workflow_dispatch', headSha: HEAD, conclusion: 'success', createdAt: '2026-10-31T21:00:08Z', displayTitle});
  const check = title => planRun({env: {EVENT: 'schedule', REPO: 'o/r', SHA: HEAD}, gh: gh({runs: [onHead(title)]}), all: ALL, minutes: () => 15, cadence: CADENCE, varies: ['jobs']});
  assert.equal((await check('E2E check · on time (Worker cron)')).suites, 'jobs', 'positive control: a normal look at an unchanged commit only explores the suites that vary');
  assert.equal((await check('Night burn-in 1/5 · aaaaaaaa')).suites, 'jobs,settings', 'a night pass on the same commit leaves the commit unlooked-at');
});

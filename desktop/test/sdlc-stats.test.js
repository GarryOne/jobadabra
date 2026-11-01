// The SDLC numbers for the Agent coding page (tools/sdlc-stats.mjs): per check and layer the runs, reds and what followed each red; the four phases' counts; all from recorded input, no network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {catchOf, computeSdlc, hasNoSpec, layerOf, nextGreen, pendingPairs, prCatch} from '../../tools/sdlc-stats.mjs';

const now = new Date('2026-11-01T18:00:00Z');
const commit = (sha, subject, files, date, lines = 20) => ({sha, subject, files, lines, date});
const merge = (pr, title, files, commits, extra = {}) => ({pr, day: '2026-11-01', title, branch: `b${pr}`, files, commits, ...extra});
const run = (name, conclusion, created, {event = 'pull_request', branch = 'b7', sha = 'a', minutes = 5} = {}) =>
  ({name, event, branch, head_sha: sha, conclusion, created_at: created, run_started_at: created, updated_at: new Date(Date.parse(created) + minutes * 60000).toISOString()});
const today = cards => cards.at(-1);

test('a run belongs to a layer by its event: pull_request, a push to main, schedule or manual; anything else is not counted', () => {
  assert.deepEqual([{event: 'pull_request'}, {event: 'push', branch: 'main'}, {event: 'push', branch: 'x'}, {event: 'schedule'}, {event: 'workflow_dispatch'}, {event: 'release'}].map(layerOf), ['pr', 'main', null, 'night', 'night', null]);
});

// Measured 1 Nov 2026 on 5 days: 490 PR reds, 40 followed by a green on the SAME commit (a re-run), 432 by a green on DIFFERENT code (amend, rebase and force-push keep author dates, so dates cannot tell a fix from a re-run).
test('on a PR, a red is classed by the diff between its commit and the next green run of the same workflow on the branch; same commit = flaky; a rebase or a missing diff = rebase; never green = no fix seen', () => {
  const runs = [run('CI · Tests', 'failure', '2026-11-01T08:30:00Z', {sha: 'r1'}), run('CI · Tests', 'success', '2026-11-01T09:30:00Z', {sha: 'g1'}),
    run('CI · Harness', 'failure', '2026-11-01T08:40:00Z', {sha: 'h1'}), run('CI · Harness', 'success', '2026-11-01T08:50:00Z', {sha: 'h1'}),
    run('CI · Pull request', 'failure', '2026-11-01T08:30:00Z', {sha: 'p1'}),
    run('CI · Tests · worker', 'failure', '2026-11-01T08:30:00Z', {sha: 'w1'}), run('CI · Tests · worker', 'success', '2026-11-01T08:50:00Z', {sha: 'w2'}),
    run('CI · Tests · desktop', 'failure', '2026-11-01T08:30:00Z', {sha: 'd1'}), run('CI · Tests · desktop', 'success', '2026-11-01T08:50:00Z', {sha: 'd2'})];
  const compares = {'r1...g1': {status: 'ahead', files: ['src/x.py'], lines: 30, subject: 'Fix it'}, 'w1...w2': {status: 'diverged', files: ['src/a.py'], lines: 400, subject: 'Rebase'}};
  const {layers} = today(computeSdlc({merges: [], runs, compares}, {days: 3, now}));
  assert.deepEqual([layers.pr['CI · Tests'].runs, layers.pr['CI · Tests'].fails, layers.pr['CI · Tests'].catches.product], [2, 1, 1]);
  assert.equal(layers.pr['CI · Harness'].catches.flaky, 1);
  assert.equal(layers.pr['CI · Pull request'].catches.nofix, 1);
  assert.equal(layers.pr['CI · Tests · worker'].catches.rebase, 1, 'a diverged pair is a rebase, not a guess');
  assert.equal(layers.pr['CI · Tests · desktop'].catches.rebase, 1, 'a pair GitHub has no diff for');
  assert.equal(layers.pr['CI · Tests'].secs, 600, 'seconds are the runs added together');
});

test('the next green is on the same branch and workflow within a day; the pairs to compare are only reds followed by a green on different code', () => {
  const runs = [run('CI · Tests', 'failure', '2026-11-01T08:00:00Z', {sha: 'r', branch: 'one'}), run('CI · Tests', 'success', '2026-11-01T09:00:00Z', {sha: 'g', branch: 'one'}),
    run('CI · Tests', 'success', '2026-11-01T09:00:00Z', {sha: 'other', branch: 'two'}), run('CI · Tests', 'failure', '2026-11-01T08:00:00Z', {sha: 'late', branch: 'three'}), run('CI · Tests', 'success', '2026-11-03T08:00:00Z', {sha: 'later', branch: 'three'})];
  assert.equal(nextGreen(runs[0], runs).head_sha, 'g');
  assert.equal(nextGreen(runs[3], runs), null, 'a green two days later is not the fix');
  assert.deepEqual(pendingPairs({runs}, {days: 3, now}), ['r...g']);
  assert.equal(prCatch(runs[3], runs), 'nofix');
});

test('on main and in the night, a red is classed by the first merge after it that left the workflow green; no later green is no fix seen', () => {
  const merges = [merge(9, 'Fix the python tests', ['src/ai/x.py'], [], {day: '2026-11-01', at: '2026-11-01T12:00:00Z'})];
  const runs = [run('CI · Tests', 'failure', '2026-11-01T01:00:00Z', {event: 'push', branch: 'main', sha: 'm1'}), run('CI · Tests', 'success', '2026-11-01T23:30:00Z', {event: 'push', branch: 'main', sha: 'm2'}),
    run('Nightly burn-in', 'failure', '2026-11-01T02:00:00Z', {event: 'schedule', branch: 'main', sha: 'n1'})];
  const {layers, phases} = today(computeSdlc({merges, runs}, {days: 3, now: new Date('2026-11-01T23:59:00Z')}));
  assert.equal(layers.main['CI · Tests'].catches.product, 1);
  assert.equal(layers.night['Nightly burn-in'].catches.nofix, 1);
  assert.equal(phases.redMain, 1, 'a red on main that day');
});

test('the phases: merged PRs, those with product files and no spec or doc, commits per PR, reverts, fix PRs in an area merged in the last 7 days, closed unmerged, bugs, days main was red', () => {
  const merges = [merge(1, 'Add a card', ['src/ai/a.py'], [commit('a', 'x', [], '2026-10-30T08:00:00Z')], {day: '2026-10-30'}), merge(2, 'Fix the card', ['src/ai/a.py', 'docs/note.md'], [commit('b', 'x', [], '2026-11-01T08:00:00Z'), commit('c', 'y', [], '2026-11-01T09:00:00Z')]),
    merge(3, 'Revert "Add a card"', ['src/ai/a.py'], [])];
  const input = {merges, closedUnmerged: ['2026-11-01T10:00:00Z', '2026-10-01T10:00:00Z'], bugs: ['2026-11-01T11:00:00Z'], runs: [run('CI · Tests', 'failure', '2026-11-01T01:00:00Z', {event: 'push', branch: 'main'})]};
  const {phases, bugs} = today(computeSdlc(input, {days: 3, now}));
  assert.deepEqual(phases, {merged: 2, nospec: 1, unmerged: 1, prCommits: 2, fixAfter: 1, reverts: 1, redMain: 1});
  assert.equal(bugs, 1);
  assert.ok(hasNoSpec(merges[0]) && !hasNoSpec(merges[1]));
});

test('catchOf: green again on the same commit is flaky, a fix after the red is its class, nothing green later is no fix seen', () => {
  const red = {at: 1000, sha: 'r'};
  assert.equal(catchOf(red, [{at: 5000, sha: 'r'}], []), 'flaky');
  assert.equal(catchOf(red, [{at: 5000, sha: 'g'}], [{at: 3000, sha: 'f', subject: 'Fix', files: ['src/a.py'], lines: 30}]), 'product');
  assert.equal(catchOf(red, [], []), 'nofix');
});

test('nothing but a check name, counts and seconds is in a card: no branch name, no commit text', () => {
  const runs = [run('CI · Tests', 'failure', '2026-11-01T08:30:00Z', {branch: 'secret-branch'})];
  const merges = [merge(7, 'Fix the secret thing', ['src/x.py'], [commit('c1', 'secret subject', ['src/x.py'], '2026-11-01T09:00:00Z')], {branch: 'secret-branch'})];
  assert.ok(!/secret/.test(JSON.stringify(computeSdlc({merges, runs}, {days: 3, now}))));
});

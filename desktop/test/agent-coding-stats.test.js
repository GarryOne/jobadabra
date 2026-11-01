// The CI side of the agent coding page (tools/agent-coding-stats.mjs): merged PRs and the CI share, what fixed a red, fix PRs per area, CI minutes per push; all from recorded input, no network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {areaOf, classifyFix, compute, fetchMerges, isFixPr, kindOfFile} from '../../tools/agent-coding-stats.mjs';

const now = new Date('2026-11-01T12:00:00Z');
const commit = (sha, subject, files, lines = 20) => ({sha, subject, files, lines});
const merge = (pr, title, files, commits, extra = {}) => ({pr, day: '2026-11-01', title, branch: `b${pr}`, files, commits, ...extra});
const run = (name, sha, conclusion, pr, {created = '2026-11-01T08:00:00Z', started = '2026-11-01T08:02:00Z', updated = '2026-11-01T08:12:00Z'} = {}) => ({name, head_sha: sha, conclusion, created_at: created, run_started_at: started, updated_at: updated, pr});

test('merged PRs and the share that change CI or tooling', () => {
  const [, , today] = compute({merges: [merge(1, 'Add a card', ['src/ai/x.py'], []), merge(2, 'Tune the gate', ['tools/ship.sh', 'src/a.py'], []), merge(3, 'Harness', ['desktop/e2e/lib/x.mjs'], []), merge(4, 'Old', ['tools/a.sh'], [], {day: '2026-10-20'})], runs: []}, {days: 3, now});
  assert.deepEqual(today.prs, {merged: 3, ci: 2});
});

test('a fix PR is a "fix" in its title or branch; its area is the first two folders of its product files, once per PR; 3 in a day add up', () => {
  assert.ok(isFixPr({title: 'Fix the dim', branch: 'x'}) && isFixPr({title: 'Restart', branch: 'a8/fix-restart'}) && !isFixPr({title: 'Prefix handling', branch: 'x'}));
  assert.equal(areaOf('desktop/renderer/panel/x.js'), 'desktop/renderer');
  assert.equal(areaOf('extension/x.js'), 'extension');
  const merges = [1, 2, 3].map(n => merge(n, `Fix thing ${n}`, ['desktop/renderer/a.js', 'desktop/renderer/b.js', 'desktop/test/a.test.js'], []));
  const [, , today] = compute({merges, runs: []}, {days: 3, now});
  assert.deepEqual(today.fixPrs, {'desktop/renderer': 3});
});

test('a red is classed by the first LATER commit of its PR with a green run of the same workflow', () => {
  const commits = [commit('a', 'Add', ['src/x.py']), commit('b', 'Try', ['tests/t.py']), commit('c', 'Fix stale expectation count', ['tools/y.mjs'], 4), commit('d', 'Fix it', ['src/x.py'], 30)];
  const input = {merges: [merge(7, 'x', [], commits)], runs: [run('CI · Tests', 'a', 'failure', 7), run('CI · Tests', 'b', 'failure', 7), run('CI · Tests', 'c', 'success', 7), run('CI · Harness', 'b', 'failure', 7), run('CI · Harness', 'd', 'success', 7)]};
  const [, , today] = compute(input, {days: 3, now});
  assert.deepEqual(today.reds, {product: 1, test: 0, ci: 0, form: 2, nofix: 0});
});

test('a red with no later green is "no fix seen"; a red on an unmerged PR or a commit that left the branch is not counted', () => {
  const input = {merges: [merge(7, 'x', [], [commit('a', 'Add', ['src/x.py'])])], runs: [run('CI · Tests', 'a', 'failure', 7), run('CI · Tests', 'z', 'failure', 7), run('CI · Tests', 'q', 'failure', 99), run('CI · Tests', 'a', 'failure', null)]};
  const [, , today] = compute(input, {days: 3, now});
  assert.deepEqual(today.reds, {product: 0, test: 0, ci: 0, form: 0, nofix: 1});
});

test('what a fixing commit was: product code, test drift, CI/tooling, or form', () => {
  assert.equal(classifyFix(commit('x', 'Handle the empty list', ['src/a.py'], 40)), 'product');
  assert.equal(classifyFix(commit('x', 'Update', ['tests/test_a.py', 'desktop/test/b.js'])), 'test');
  assert.equal(classifyFix(commit('x', 'Make ship wait', ['tools/ship.sh', '.github/workflows/a.yml'], 12)), 'ci');
  assert.equal(classifyFix(commit('x', 'Add the recorded-unneeded trailer', ['src/a.py'], 2)), 'form');
  assert.equal(classifyFix(commit('x', 'empty', [], 0)), 'form');
  assert.deepEqual(['docs/a.md', 'desktop/e2e/a.mjs', 'desktop/renderer/a.js', 'lanes.json'].map(kindOfFile), ['ci', 'test', 'product', 'ci']);
});

test('CI minutes per push: runs of one commit added together, the slowest start is its wait, cancelled minutes counted apart', () => {
  const runs = [run('A', 's1', 'success', 1, {created: '2026-11-01T08:00:00Z', started: '2026-11-01T08:01:00Z', updated: '2026-11-01T08:11:00Z'}),
    run('B', 's1', 'success', 1, {created: '2026-11-01T08:00:00Z', started: '2026-11-01T08:04:00Z', updated: '2026-11-01T08:10:00Z'}),
    run('A', 's2', 'cancelled', 1, {created: '2026-11-01T09:00:00Z', started: '2026-11-01T09:00:00Z', updated: '2026-11-01T09:05:00Z'})];
  const [, , today] = compute({merges: [], runs}, {days: 3, now});
  assert.deepEqual(today.wall, [16, 5]);
  assert.deepEqual(today.queue, [4, 0]);
  assert.equal(today.cancelledMin, 5);
});

test('merges are read from git: the PR number, the title line, the branch, the files and the commits oldest first', () => {
  const log = ['M1\x1f2026-11-01\x1fMerge pull request #12 from GarryOne/fix-the-dim\x1f[ac] Fix the dim\n\nmore\x1e', 'M2\x1f2026-11-01\x1fRevert something\x1f\x1e'].join('\n');
  const git = (...args) => (args[0] === 'diff' ? 'src/a.py\ntools/b.sh\n' : args.includes('--numstat') ? '\x1ec1\x1fFirst\n3\t1\tsrc/a.py\n\x1ec2\x1fSecond\n10\t0\ttools/b.sh\n' : log);
  const [one, ...rest] = fetchMerges({days: 3, now, git});
  assert.equal(rest.length, 0);
  assert.deepEqual([one.pr, one.title, one.branch, one.files], [12, '[ac] Fix the dim', 'fix-the-dim', ['src/a.py', 'tools/b.sh']]);
  assert.deepEqual(one.commits.map(item => [item.sha, item.lines]), [['c1', 4], ['c2', 10]]);
});

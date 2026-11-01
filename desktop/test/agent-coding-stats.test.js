// The CI side of the agent coding page (tools/agent-coding-stats.mjs): merged PRs and the CI share, what fixed a red, fix PRs per area, CI minutes per push; all from recorded input, no network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {areaOf, classifyFix, compute, fetchMerges, isFixPr, kindOfFile} from '../../tools/agent-coding-stats.mjs';

const now = new Date('2026-11-01T12:00:00Z');
const commit = (sha, subject, files, lines = 20) => ({sha, subject, files, lines});
const merge = (pr, title, files, commits, extra = {}) => ({pr, day: '2026-11-01', title, branch: `b${pr}`, files, commits, ...extra});
const run = (name, sha, conclusion, pr, {branch = null, created = '2026-11-01T08:00:00Z', started = '2026-11-01T08:02:00Z', updated = '2026-11-01T08:12:00Z'} = {}) => ({name, head_sha: sha, conclusion, created_at: created, run_started_at: started, updated_at: updated, pr, branch});

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

// Owner, 1 Nov 2026: the live page showed "no reds" in every week. Cause (measured: 0 of 29 runs of a merged PR list a pull request): GitHub empties a run's pull_requests once its branch is gone,
// so every red lost its PR. The run's branch name (the merge commit's "from owner/branch") is what still joins them.
test('a red on a merged PR is found by its branch when the run no longer lists its pull request', () => {
  const commits = [commit('a', 'Add', ['src/x.py']), commit('b', 'Fix it', ['src/x.py'], 30)];
  const input = {merges: [merge(7, 'x', [], commits)], runs: [run('CI · Tests', 'a', 'failure', null, {branch: 'b7'}), run('CI · Tests', 'b', 'success', null, {branch: 'b7'}), run('CI · Tests', 'a', 'failure', null, {branch: 'some-other-branch'})]};
  const [, , today] = compute(input, {days: 3, now});
  assert.deepEqual(today.reds, {product: 1, test: 0, ci: 0, form: 0, nofix: 0});
});

test('two merged PRs that used the same branch name each keep their own reds', () => {
  const first = merge(7, 'x', [], [commit('a', 'Add', ['src/x.py']), commit('b', 'Fix it', ['src/x.py'], 30)], {branch: 'issue-5'});
  const second = merge(8, 'y', [], [commit('c', 'Add', ['src/y.py']), commit('d', 'Fix it', ['tests/y.py'], 30)], {branch: 'issue-5'});
  const runs = [run('CI · Tests', 'a', 'failure', null, {branch: 'issue-5'}), run('CI · Tests', 'b', 'success', null, {branch: 'issue-5'}), run('CI · Tests', 'c', 'failure', null, {branch: 'issue-5'}), run('CI · Tests', 'd', 'success', null, {branch: 'issue-5'})];
  const [, , today] = compute({merges: [first, second], runs}, {days: 3, now});
  assert.deepEqual(today.reds, {product: 1, test: 1, ci: 0, form: 0, nofix: 0});
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
  const log = ['M1\x1f2026-11-01\x1f2026-11-01T10:00:00+00:00\x1fMerge pull request #12 from GarryOne/fix-the-dim\x1f[ac] Fix the dim\n\nmore\x1e', 'M2\x1f2026-11-01\x1f2026-11-01T11:00:00+00:00\x1fRevert something\x1f\x1e'].join('\n');
  const git = (...args) => (args[0] === 'diff' ? 'src/a.py\ntools/b.sh\n' : args.includes('--numstat') ? '\x1ec1\x1fFirst\n3\t1\tsrc/a.py\n\x1ec2\x1fSecond\n10\t0\ttools/b.sh\n' : log);
  const [one, ...rest] = fetchMerges({days: 3, now, git});
  assert.equal(rest.length, 0);
  assert.equal(one.at, '2026-11-01T10:00:00+00:00', 'the merge time, for ordering against runs');
  assert.deepEqual([one.pr, one.title, one.branch, one.files], [12, '[ac] Fix the dim', 'fix-the-dim', ['src/a.py', 'tools/b.sh']]);
  assert.deepEqual(one.commits.map(item => [item.sha, item.lines, item.subject]), [['c1', 4, 'First'], ['c2', 10, 'Second']]);
});

// Owner, 1 Nov 2026: all 3 repos squash-merge only, so main holds one "<PR title> (#n)" commit per PR and no merge commit; the Agent coding tab missed every PR from 1 Nov.
const squashLog = ['S1\x1f2026-11-01\x1f2026-11-01T10:00:00+00:00\x1f[ac] Fix the dim (#2891)\x1f\x1e', 'M1\x1f2026-10-31\x1f2026-10-31T10:00:00+00:00\x1fMerge pull request #12 from GarryOne/old-branch\x1f[ac] Old\x1e',
  'D1\x1f2026-11-01\x1f2026-11-01T09:00:00+00:00\x1fDirect commit on main\x1f\x1e'].join('\n');
const squashGit = (...args) => (args[0] === 'diff' ? 'src/a.py\ntools/b.sh\n' : args.includes('--numstat') ? '\x1ec1\x1fFirst\n3\t1\tsrc/old.py\n' : squashLog);
const squashApi = (calls = []) => path => {
  calls.push(path);
  if (path === 'rate_limit') return {resources: {core: {remaining: 4000}}};
  if (path.endsWith('/pulls/2891')) return {head: {ref: 'ac/fix-the-dim'}};
  if (path.includes('/pulls/2891/commits')) return [{sha: 'k1', commit: {message: 'Add the dim\n\nbody'}}, {sha: 'k2', commit: {message: 'Fix it'}}];
  if (path.endsWith('/commits/k1')) return {files: [{filename: 'src/a.py', additions: 5, deletions: 1}]};
  if (path.endsWith('/commits/k2')) return {files: [{filename: 'tools/b.sh', additions: 2, deletions: 0}, {filename: 'desktop/test/a.test.js', additions: 1, deletions: 1}]};
  throw new Error(`unexpected ${path}`);
};

test('a squash-merged PR (subject ends in "(#n)") counts as one PR with its branch and its commits from GitHub; old merge commits and direct commits stay as before', () => {
  const merges = fetchMerges({days: 3, now, git: squashGit, api: squashApi()});
  assert.deepEqual(merges.map(item => item.pr), [2891, 12], 'the squash commit and the old merge commit, the direct commit skipped');
  const [one] = merges;
  assert.deepEqual([one.title, one.branch, one.day, one.at, one.files], ['[ac] Fix the dim', 'ac/fix-the-dim', '2026-11-01', '2026-11-01T10:00:00+00:00', ['src/a.py', 'tools/b.sh']]);
  assert.deepEqual(one.commits.map(item => [item.sha, item.subject, item.files, item.lines]), [['k1', 'Add the dim', ['src/a.py'], 6], ['k2', 'Fix it', ['tools/b.sh', 'desktop/test/a.test.js'], 4]]);
  assert.deepEqual(merges[1].commits.map(item => item.sha), ['c1'], 'the old shape still reads <sha>^1..<sha>^2 from git');
});

test('the Agent coding card counts the squash-merged PR and joins its red to its green by branch and commit', () => {
  const merges = fetchMerges({days: 3, now, git: squashGit, api: squashApi()});
  const input = {merges, runs: [run('CI · Tests', 'k1', 'failure', null, {branch: 'ac/fix-the-dim'}), run('CI · Tests', 'k2', 'success', null, {branch: 'ac/fix-the-dim'})]};
  const [, , today] = compute(input, {days: 3, now});
  assert.deepEqual(today.prs, {merged: 1, ci: 1});
  assert.deepEqual(today.reds, {product: 0, test: 0, ci: 1, form: 0, nofix: 0});
});

test('when the GitHub rate limit is low the squash-merged PR is still counted, without its branch and commits', () => {
  const api = path => { if (path === 'rate_limit') return {resources: {core: {remaining: 10}}}; throw new Error(`no call after a low limit: ${path}`); };
  const [one] = fetchMerges({days: 3, now, git: squashGit, api});
  assert.deepEqual([one.pr, one.title, one.branch, one.commits], [2891, '[ac] Fix the dim', null, []]);
});

// Gitar on #2893: a PR with more than 100 commits lost its tail; a rate-limit stop mid-PR left a half-read list that counted a red as "no fix".
test('a squash-merged PR with 101 commits reads both pages of its commit list', () => {
  const api = path => {
    if (path === 'rate_limit') return {resources: {core: {remaining: 4000}}};
    if (path.endsWith('/pulls/2891')) return {head: {ref: 'big'}};
    if (path.includes('/pulls/2891/commits')) return Array.from({length: path.endsWith('page=1') ? 100 : 1}, (_, n) => ({sha: `k${(path.endsWith('page=1') ? 0 : 100) + n}`, commit: {message: 'c'}}));
    return {files: []};
  };
  const [one] = fetchMerges({days: 3, now, git: squashGit, api});
  assert.equal(one.commits.length, 101);
  assert.equal(one.commits.at(-1).sha, 'k100');
});

test('when the rate limit trips in the middle of a squash-merged PR, that PR keeps no commits rather than the first few', () => {
  let checks = 0;
  const api = path => {
    if (path === 'rate_limit') return {resources: {core: {remaining: checks++ ? 10 : 4000}}};
    if (path.endsWith('/pulls/2891')) return {head: {ref: 'big'}};
    if (path.includes('/pulls/2891/commits')) return Array.from({length: 40}, (_, n) => ({sha: `k${n}`, commit: {message: 'c'}}));
    return {files: []};
  };
  const [one] = fetchMerges({days: 3, now, git: squashGit, api});
  assert.deepEqual([one.pr, one.branch, one.commits], [2891, 'big', []]);
});

test('when the rate limit trips on the second page of a squash-merged PR\'s commit list, the first page is dropped too', () => {
  // The limit is checked on every 25th call, counted across PRs: PR 1 (pull + list + 21 details = 23 calls) puts PR 2's second list call on call 125.
  const log = ['S1\x1f2026-11-01\x1f2026-11-01T11:00:00+00:00\x1fSmall PR (#2891)\x1f\x1e', 'S2\x1f2026-11-01\x1f2026-11-01T10:00:00+00:00\x1fBig PR (#2892)\x1f\x1e'].join('\n');
  let checks = 0;
  const api = path => {
    if (path === 'rate_limit') return {resources: {core: {remaining: checks++ === 5 ? 10 : 4000}}};
    if (/pulls\/\d+$/.test(path)) return {head: {ref: `b${path.split('/').pop()}`}};
    if (path.includes('/pulls/2891/commits')) return Array.from({length: 21}, (_, n) => ({sha: `s${n}`, commit: {message: 'c'}}));
    if (path.includes('/pulls/2892/commits')) return path.endsWith('page=1') ? Array.from({length: 100}, (_, n) => ({sha: `k${n}`, commit: {message: 'c'}})) : [{sha: 'k100', commit: {message: 'c'}}];
    return {files: []};
  };
  const merges = fetchMerges({days: 3, now, git: (...args) => (args.includes('--first-parent') ? log : squashGit(...args)), api});
  const byPr = Object.fromEntries(merges.map(item => [item.pr, item.commits.length]));
  assert.deepEqual(byPr, {2891: 21, 2892: 0}, 'the PR read before the stop is whole; PR 2892 keeps none of its page 1');
  assert.ok(checks >= 6, 'the stop was tripped by the page-2 call, not earlier');
});

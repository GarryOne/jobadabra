// What a run of the e2e workflow does, decided in one place (plan-run.mjs): which suites, which commit, whether the AI reviews screenshots, and, for the release gate
// (the release run's "Test · Mac + Linux", desktop.yml), which release to approve when everything passes. gh is a stub: no network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planRun} from '../plan-run.mjs';
import {MAX_RUNS_PER_COMMIT, exploreDecision, reviewNeeded, shouldSkipScheduled, waitingFindings} from '../lib/plan.mjs';
// The suites a plan runs, once each (a gate runs each suite on two stores: two jobs).
const suitesOf = out => [...new Set(JSON.parse(out.matrix).include.map(item => item.suite))];

const ALL = ['activity', 'apply', 'jobs', 'settings'];
const HEAD = 'a'.repeat(40), OLD = 'b'.repeat(40);
const issue = (comments = 0, labels = [], kind = 'layout') => ({number: 1, state: 'OPEN', body: `**MEDIUM** · ${kind} · found by the AI screenshot review`, labels: [{name: 'auto-ui'}, ...labels.map(name => ({name}))], comments: Array.from({length: comments}, () => ({body: 'Seen again in run x'}))});

// A gh that answers the calls the plan makes. `files`: what changed between two commits; `runs`: finished e2e runs, newest first; `issues`: open auto-ui issues; `releases`: [tag, sha] newest first.
function gh({files = [], runs = [], issues = [], releases = [], build = 'success', releasing = []} = {}) {
  return args => {
    const text = args.join(' ');
    if (args[0] === 'run' && args[1] === 'list' && args.includes('desktop.yml')) return JSON.stringify(releasing);
    if (/^api repos\/[^/]+\/[^/]+\/compare\//.test(text)) return files.join('\n');
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify(runs);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(issues);
    if (/^api repos\/[^/]+\/[^/]+\/actions\/runs\/\d+\/jobs/.test(text)) return build;
    if (args[0] === 'release' && args[1] === 'list') return JSON.stringify(releases.map(([tagName]) => ({tagName})));
    const commit = /commits\/(desktop-v\S+)/.exec(text);
    if (commit) return (releases.find(([tag]) => tag === commit[1]) || [])[1] || '';
    throw new Error(`unexpected gh call: ${text}`);
  };
}
const plan = (env, stub, varies = ['jobs']) => planRun({env: {REPO: 'o/r', ...env}, gh: gh(stub), all: ALL, minutes: () => 15, varies});

test('findings that wait for a second sighting are counted; parked ones are not', () => {
  assert.equal(waitingFindings([issue(0), issue(1), issue(0, ['needs-human']), issue(0, ['wontfix-auto'])]), 1);
  assert.equal(waitingFindings([issue(0, [], 'test-failure')]), 0, 'a failed step is never fixed automatically: no confirming run for it');
});

test('a scheduled run is skipped only when nothing changed and nothing waits', () => {
  assert.equal(shouldSkipScheduled({event: 'schedule', head: HEAD, lastSha: HEAD, waiting: 0}), true);
  assert.equal(shouldSkipScheduled({event: 'schedule', head: HEAD, lastSha: OLD, waiting: 0}), false);
  assert.equal(shouldSkipScheduled({event: 'schedule', head: HEAD, lastSha: HEAD, waiting: 2}), false);
  assert.equal(shouldSkipScheduled({event: 'schedule', head: HEAD, lastSha: '', waiting: 0}), false);
  assert.equal(shouldSkipScheduled({event: 'workflow_dispatch', head: HEAD, lastSha: HEAD, waiting: 0}), false);
});

test('the AI reviews screenshots only when the UI or its tests changed, or a finding waits', () => {
  assert.equal(reviewNeeded({files: ['desktop/lib/notion.js', 'src/daily.py'], waiting: 0, known: true}), false);
  assert.equal(reviewNeeded({files: ['desktop/renderer/pages/jobs.js'], waiting: 0, known: true}), true);
  assert.equal(reviewNeeded({files: ['desktop/e2e/suites/activity.mjs'], waiting: 0, known: true}), true);
  assert.equal(reviewNeeded({files: [], waiting: 1, known: true}), true);
  assert.equal(reviewNeeded({files: [], waiting: 0, known: false}), true, 'no earlier run to compare with: review');
});

const ago = hours => new Date(Date.UTC(2026, 9, 3, 12) - hours * 3600000).toISOString();
const sched = (hours, extra = {}) => ({event: 'schedule', headSha: HEAD, conclusion: 'success', createdAt: ago(hours), displayTitle: 'CI · End-to-end journey', ...extra});

test('a commit gets at most MAX_RUNS_PER_COMMIT looks; a new commit starts over; the first run ever goes', () => {
  const runs = n => Array.from({length: n}, (_, i) => ({createdAt: ago(8 * (i + 1))}));
  assert.equal(MAX_RUNS_PER_COMMIT, 3);
  assert.equal(exploreDecision({head: HEAD, lastSha: '', runsOnHead: []}).run, true, 'the very first run');
  const fresh = exploreDecision({head: HEAD, lastSha: OLD, runsOnHead: runs(9)});
  assert.deepEqual([fresh.run, fresh.exploring], [true, false], 'a new commit starts over, whatever ran on the old one');
  for (const n of [1, 2]) assert.deepEqual([exploreDecision({head: HEAD, lastSha: HEAD, runsOnHead: runs(n)}).run, exploreDecision({head: HEAD, lastSha: HEAD, runsOnHead: runs(n)}).exploring], [true, true]);
  const done = exploreDecision({head: HEAD, lastSha: HEAD, runsOnHead: runs(3)});
  assert.equal(done.run, false);
  assert.match(done.why, /3 looks at this commit already/);
});

test('a schedule on an unchanged commit takes up to three looks with the AI review on, only the suites that vary; other runs of main\'s code do not count', async () => {
  const one = await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [sched(8)]});
  assert.deepEqual([one.count, one.review], ['1', '1'], 'only the suite that varies: the other three would repeat themselves');
  assert.match(one.why, /look 2 of 3/);
  assert.equal((await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [sched(8)]}, [])).count, '0', 'no suite varies: nothing to explore');
  assert.equal((await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [sched(8), sched(16)]})).count, '1', 'the third look');
  assert.equal((await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [sched(8), sched(16), sched(24)]})).count, '0', 'three looks: nothing until the next commit');
  const others = [sched(8), sched(16, {displayTitle: 'RC soak desktop-v1'}), sched(24, {displayTitle: 'Stable canary desktop-v1'}), sched(30, {event: 'workflow_run'}), sched(40, {event: 'push'})];
  assert.match((await plan({EVENT: 'schedule', SHA: HEAD}, {runs: others})).why, /look 2 of 3/, 'soak top-ups, the canary, the gate and pushes test other things');
});

// Gate G7 (26 Oct 2026): main's 23:33 and 23:47 runs skipped while beta 2 ran and ended green with no suite run; as looks, three such skips retire a commit nobody tested.
test('a run that tested nothing (ended cancelled by "Nothing tested") is neither a look nor the last tested commit', async () => {
  const skipped = hours => sched(hours, {conclusion: 'cancelled'});
  const fresh = await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [skipped(1), skipped(2), skipped(3), {event: 'schedule', headSha: OLD, conclusion: 'success'}], files: ['desktop/lib/x.js']});
  assert.equal(fresh.count, String(ALL.length), 'three skipped runs on HEAD: HEAD is still a new commit, every suite runs');
  assert.match(fresh.why, /a new commit/);
  assert.match((await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [skipped(1), sched(8)]})).why, /look 2 of 3/, 'only the tested run is a look');
});

test('a bisect step, a canary or a mutant on main\'s name never makes main\'s head "tested" (gate G2b)', async () => {
  // A PR's run (another branch) and the steps run after a merge (a few steps, not a look) neither: the nightly full run stays (PR 4, owner 26 Oct 2026).
  for (const displayTitle of [`Bisect cardstates ${OLD}`, 'Stable canary desktop-v1', 'Mutant raw-http-error', 'E2E for PR · settings · some-branch', 'E2E after merge · aaaaaaa · settings']) {
    const out = await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [sched(1, {event: 'workflow_dispatch', displayTitle}), {event: 'schedule', headSha: OLD, conclusion: 'success'}], files: ['desktop/lib/x.js']});
    assert.match(out.why, /a new commit/, displayTitle);
  }
});

test('a schedule while a release run tests plans no suite and says why (e2e.yml then ends the run grey)', async () => {
  const out = await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [{event: 'schedule', headSha: OLD, conclusion: 'success'}], files: ['desktop/lib/x.js'], releasing: [{status: 'in_progress', displayTitle: 'Beta by hand'}]});
  assert.equal(out.count, '0');
  assert.match(out.why, /release run is testing \(Beta by hand\)/);
});

test('a schedule with new commits runs every suite on that commit', async () => {
  const changed = await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [{event: 'schedule', headSha: OLD, conclusion: 'success'}], files: ['desktop/lib/x.js']});
  assert.deepEqual([changed.count, changed.ref, changed.review, changed.tag], ['4', HEAD, '0', '']);
});

test('a push to main runs only the suites its files changed, and a push run is never the last run to compare with', async () => {
  const out = await plan({EVENT: 'push', SHA: HEAD, BEFORE: OLD}, {files: ['desktop/e2e/suites/jobs.mjs'], runs: [{event: 'push', headSha: OLD, conclusion: 'success'}]});
  assert.deepEqual(suitesOf(out), ['jobs']);
  assert.equal(out.review, '1', 'no earlier non-push run: review');
});

test('every changed file counts, one per line', async () => {
  const out = await plan({EVENT: 'push', SHA: HEAD, BEFORE: OLD}, {files: ['desktop/e2e/suites/jobs.mjs', 'extension/content.js', 'docs/x.md']});
  assert.deepEqual(suitesOf(out), ['apply', 'jobs']);
});

test('a manual dry run of the promotion runs no suite', async () => {
  const out = await plan({EVENT: 'workflow_dispatch', SHA: HEAD, PROMOTE_TAG: 'desktop-v1.2'}, {});
  assert.equal(out.count, '0');
});

test('a manual run runs what it names', async () => {
  const out = await plan({EVENT: 'workflow_dispatch', SHA: HEAD, ONLY: 'jobs,settings'}, {});
  assert.deepEqual(suitesOf(out), ['jobs', 'settings']);
});






test('cadence: always runs on every schedule, nightly only in the nightly gate, manual never by itself', async () => {
  const cadence = {settings: 'always', jobs: 'always', apply: 'nightly', activity: 'manual'};
  const run = (env, stub) => planRun({env: {REPO: 'o/r', ...env}, gh: gh(stub), all: ALL, cadence, minutes: () => 15});
  const names = out => suitesOf(out);
  const scheduled = await run({EVENT: 'schedule', SHA: HEAD}, {runs: [{event: 'schedule', headSha: OLD, conclusion: 'success'}], files: ['desktop/lib/x.js']});
  assert.deepEqual(names(scheduled), ['jobs', 'settings'], 'the three-a-day schedule: only the always suites');
  const empty = await run({EVENT: 'workflow_dispatch', SHA: HEAD, ONLY: ''}, {});
  assert.deepEqual(names(empty), ['apply', 'jobs', 'settings'], 'a manual run with no names: everything that is not manual');
  const named = await run({EVENT: 'workflow_dispatch', SHA: HEAD, ONLY: 'activity'}, {});
  assert.deepEqual(names(named), ['activity'], 'a person can still name a manual suite');
  const pushed = await run({EVENT: 'push', SHA: HEAD, BEFORE: OLD}, {files: ['desktop/e2e/suites/activity.mjs'], runs: [{event: 'push', headSha: OLD, conclusion: 'success'}]});
  assert.equal(pushed.count, '0', 'a push that only touches a manual suite runs nothing');
});

test('cadence: the nightly release gate runs the always and nightly suites, not the manual ones', async () => {
  const cadence = {settings: 'always', jobs: 'always', apply: 'nightly', activity: 'manual'};
  const out = await planRun({env: {REPO: 'o/r', EVENT: 'schedule', SHA: OLD, TARGET_REF: 'desktop-v1', GATE_TAG: 'desktop-v1'},
    gh: gh({releases: [['desktop-v1', HEAD]]}), all: ALL, cadence, minutes: () => 15});
  assert.deepEqual(suitesOf(out), ['apply', 'jobs', 'settings']);
});

test('a manual run with target_ref tests that release\'s commit, not main\'s', async () => {
  const stub = args => (args[0] === 'api' && /commits\/desktop-v0\.5\.252$/.test(args[1]) ? 'deadbeef00000000000000000000000000000000\n' : '[]');
  const out = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'mainsha', TARGET_REF: 'desktop-v0.5.252'}, gh: stub, all: ALL, minutes: () => 15});
  assert.equal(out.ref, 'deadbeef00000000000000000000000000000000');
  const plain = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'mainsha'}, gh: stub, all: ALL, minutes: () => 15});
  assert.equal(plain.ref, 'mainsha', 'no target_ref: main as before');
  await assert.rejects(planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'mainsha', TARGET_REF: 'nope'}, gh: () => { throw new Error('404'); }, all: ALL, minutes: () => 15}), /not a commit/);
});

test('a manual gate for a tag runs the nightly gate\'s suites on that tag\'s commit and names the tag to approve', async () => {
  const stub = args => (args[0] === 'api' && /commits\/desktop-v1\.5$/.test(args[1]) ? 'cafe'.repeat(10) + '\n' : '[]');
  const out = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'mainsha', TARGET_REF: 'desktop-v1.5', GATE_TAG: 'desktop-v1.5'}, gh: stub, all: ALL, minutes: () => 15});
  assert.deepEqual([out.tag, out.ref, out.count], ['desktop-v1.5', 'cafe'.repeat(10), '8']);
  const plain = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'mainsha'}, gh: stub, all: ALL, minutes: () => 15});
  assert.equal(plain.tag, '', 'a plain manual run promotes nothing');
});

test('the interactions suite has the time it needs: a job limit under what it takes cancels it and files its partial findings (5 Oct 2026)', async () => {
  const {minutes} = await import('../suites/interactions.mjs');
  assert.ok(minutes >= 20, `interactions is given ${minutes} minutes: it ran past 11 and was cancelled twice at 10`);
});


// 7 Oct 2026: the release run (desktop.yml) calls the gate as a job, so the gate arrives with the release run's own event: `schedule` for the GitHub-scheduled nightly,
// `workflow_dispatch` for the Worker's nightly and a beta by hand. gate_tag decides, never the event: a scheduled release must not be planned as a three-a-day run.
test('the gate called from the release run tests the release\'s commit whatever the event, and says its suites for the Windows gate', async () => {
  for (const EVENT of ['schedule', 'workflow_dispatch']) {
    const out = await plan({EVENT, SHA: OLD, TARGET_REF: 'desktop-v1.2', GATE_TAG: 'desktop-v1.2'}, {releases: [['desktop-v1.2', HEAD]], runs: [{event: 'schedule', headSha: HEAD, conclusion: 'success'}]});
    assert.deepEqual([out.count, out.ref, out.tag], ['8', HEAD, 'desktop-v1.2'], EVENT);
    assert.equal(out.suites, ALL.join(','), 'the same list goes to e2e-windows.yml');
  }
  assert.equal((await plan({EVENT: 'workflow_dispatch', SHA: HEAD, ONLY: 'jobs,settings'}, {})).suites, 'jobs,settings');
});

// 7 Oct 2026: both lanes test at once, so the release's gate jobs wait in the shared per-suite groups; a scheduled run queued there would cancel them.
test('a scheduled run skips while a release run is testing; a build only does not hold it', async () => {
  const stub = {runs: [{event: 'schedule', headSha: OLD, conclusion: 'success'}], files: ['desktop/lib/x.js']};
  assert.notEqual((await plan({EVENT: 'schedule', SHA: HEAD}, stub)).count, '0', 'positive control: the same schedule runs when no release is testing');
  const held = await plan({EVENT: 'schedule', SHA: HEAD}, {...stub, releasing: [{status: 'in_progress', displayTitle: 'Nightly beta'}]});
  assert.equal(held.count, '0');
  assert.match(held.why, /release run is testing/);
  assert.notEqual((await plan({EVENT: 'schedule', SHA: HEAD}, {...stub, releasing: [{status: 'in_progress', displayTitle: 'Build only (by hand, not tested)'}]})).count, '0');
  const gate = await plan({EVENT: 'schedule', SHA: OLD, TARGET_REF: 'desktop-v1.2', GATE_TAG: 'desktop-v1.2'}, {releases: [['desktop-v1.2', HEAD]], releasing: [{status: 'in_progress', displayTitle: 'Nightly beta'}]});
  assert.equal(gate.count, '8', 'the gate itself, called from that release run, runs (4 suites, each on both stores)');
});

// 7 Oct 2026 (owner: "$30 a week"): quality (Sonnet) ran in every beta by hand and on Windows too. Now: the Mac lane only, and in a beta by hand only when
// what it watches changed since the last release approved for Mac. The nightly always runs it.
test('quality: the nightly runs it; a beta by hand only after a change it watches; never on Windows', async () => {
  const cadence = {quality: 'nightly'}, watches = {quality: ['src/ai/score.py']};
  const stub = files => args => {
    const text = args.join(' ');
    // like the real gh: `release list` has no body field (7 Oct: the summary showed "Unknown JSON field"), `release view` has
    if (args[0] === 'release' && args[1] === 'list') { if (/body/.test(text)) throw new Error('Unknown JSON field: "body"'); return JSON.stringify([{tagName: 'desktop-v1.3'}, {tagName: 'desktop-v1.2'}]); }
    if (args[0] === 'release' && args[1] === 'view') return JSON.stringify({body: args[2] === 'desktop-v1.2' ? 'notes\nBeta-approved: unit suites…' : ''});
    if (/commits\/desktop-v1\.2/.test(text)) return OLD;
    if (/commits\/desktop-v1\.3/.test(text)) return HEAD;
    if (/compare\//.test(text)) return files.join('\n');
    return '[]';
  };
  const run = (kind, files) => planRun({env: {REPO: 'o/r', EVENT: 'gate', SHA: HEAD, TARGET_REF: 'desktop-v1.3', GATE_TAG: 'desktop-v1.3', GATE_KIND: kind},
    gh: stub(files), all: [...ALL, 'quality'], cadence, watches, sameOnEveryOs: ['quality'], minutes: () => 15});
  const names = out => out.suites.split(',');
  const quiet = await run('beta', ['desktop/renderer/pages/jobs.js']);
  assert.ok(!names(quiet).includes('quality'), 'positive control below: same plan, a scoring change runs it');
  assert.match(quiet.why, /quality not run: nothing it watches changed/);
  assert.ok(names(await run('beta', ['src/ai/score.py'])).includes('quality'));
  const nightly = await run('nightly', ['desktop/renderer/pages/jobs.js']);
  assert.ok(names(nightly).includes('quality'), 'the nightly always runs it');
  assert.ok(!nightly.windows_suites.split(',').includes('quality'), 'never on Windows');
  assert.ok(nightly.windows_suites.split(',').includes('jobs'));
});

test('GATE_STORE_LEGS=one: the release run gets ONE Mac job per suite (its job copy never passes the leg\'s store, so a second leg was a duplicate)', async () => {
  const stub = () => '[]';
  const gate = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'cafe'.repeat(10), TARGET_REF: 'desktop-v2', GATE_TAG: 'desktop-v2', GATE_STORE_LEGS: 'one'}, gh: stub,
    all: ['jobs', 'updates'], storeless: ['updates'], minutes: () => 15});
  assert.deepEqual(JSON.parse(gate.matrix).include.map(({suite, key}) => `${suite}:${key}`), ['jobs:jobs', 'updates:updates']);
  assert.equal(gate.count, '2');
});

test('the gate runs each suite that keeps data on both stores, one job each; other runs one job, the store left to the run number', async () => {
  const stub = args => (args[0] === 'run' && args[1] === 'list' ? '[]' : '[]');
  const gate = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'cafe'.repeat(10), TARGET_REF: 'desktop-v2', GATE_TAG: 'desktop-v2'}, gh: stub,
    all: ['jobs', 'updates'], storeless: ['updates'], minutes: () => 15});
  assert.deepEqual(JSON.parse(gate.matrix).include.map(({suite, key, store}) => ({suite, key, store})),
    [{suite: 'jobs', key: 'jobs', store: 'sqlite'}, {suite: 'jobs', key: 'jobs-standin', store: 'standin'}, {suite: 'updates', key: 'updates', store: ''}]);
  const manual = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'cafe'.repeat(10), ONLY: 'jobs'}, gh: stub, all: ['jobs', 'updates'], minutes: () => 15});
  assert.deepEqual(JSON.parse(manual.matrix).include.map(({key, store}) => ({key, store})), [{key: 'jobs', store: ''}]);
});

// The causes behind false and stale findings (5 Oct 2026): a re-sighting on a build older than the fix is stale, not a regression; every closed issue says why in one label; every issue says
// how far its build was behind main and whether its suite finished; every producer run is kept as numbers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {contextLine, stepAgeLine} from '../../lib/run-context.mjs';
import {RESOLUTIONS, labelOf, resolutionCounts, resolutionForVerdict, resolutionOf, setResolution} from '../../lib/resolution.mjs';
import {dropReason, runSummary, totalRuns} from '../../lib/run-summary.mjs';
import {classify} from '../../lib/selfheal-stats.mjs';
import {fixCommitOf, staleComment, staleSighting} from '../../lib/stale.mjs';
import {parse} from '../../lib/verdict-comment.mjs';

const issue = (labels = [], comments = [], extra = {}) => ({number: 7, state: 'CLOSED', stateReason: 'NOT_PLANNED', title: 't', labels: labels.map(name => ({name})), comments: comments.map(body => ({body})), ...extra});

test('the fix commit of a closed issue is read from a commit named, or from the pull request that was merged', () => {
  assert.equal(fixCommitOf(issue([], ['Closed: commit e47ad68 says it fixes this (https://x/runs/1)'])), 'e47ad68');
  assert.equal(fixCommitOf(issue([], ['Fixed by e47ad68: humanError turns an HTTP error into one sentence.'])), 'e47ad68');
  assert.equal(fixCommitOf(issue([], ['Fixed by https://github.com/o/r/pull/9 (merged by the UI loop).']), number => (number === 9 ? 'abc1234' : '')), 'abc1234');
  assert.equal(fixCommitOf(issue([], ['Fixed by https://github.com/o/r/pull/9']), () => ''), '', 'a pull request that cannot be resolved names no commit');
  assert.equal(fixCommitOf(issue([], ['Closed as noise.'])), '');
});

test('stale only when the tested build is behind the fix; ahead, identical, diverged, unknown or an API error is a regression', () => {
  const closed = issue([], ['Fixed by e47ad68']);
  const verdict = status => staleSighting({issue: closed, tested: '3806ebe', compare: () => status});
  assert.equal(verdict('behind').stale, true);
  for (const status of ['ahead', 'identical', 'diverged', '']) assert.equal(verdict(status).stale, false, status);
  assert.equal(staleSighting({issue: closed, tested: '3806ebe', compare: () => { throw new Error('rate limited'); }}).stale, false);
  assert.equal(staleSighting({issue: closed, tested: '', compare: () => 'behind'}).stale, false, 'no tested build: unknown');
  assert.equal(staleSighting({issue: issue([], ['Closed as noise.']), tested: '3806ebe', compare: () => 'behind'}).stale, false, 'no fix commit named: unknown');
  assert.match(staleComment(closed, {fix: 'e47ad68abc', tested: '3806ebe'}, 'https://x/runs/2'), /3806ebe[^]*before[^]*e47ad68[^]*stale sighting, not a regression/);
});

test('a finding that matches an issue a fix closed is dropped as stale on an older build, and filed as a regression on a build with the fix', async () => {
  const {triage} = await import('../../triage.mjs');
  const {normalize} = await import('../../lib/triage.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-'));
  fs.writeFileSync(path.join(dir, 'ui-findings.json'), JSON.stringify([{view: 'jobs', severity: 'severe', kind: 'tall-row', detail: 'a row is 700px tall'}]));
  const id = normalize({ui: JSON.parse(fs.readFileSync(path.join(dir, 'ui-findings.json'), 'utf8'))})[0].id;
  const run = status => {
    const calls = [];
    const closed = {number: 7, state: 'CLOSED', stateReason: 'COMPLETED', title: '[auto-ui] jobs: a row is 700px tall', body: '**HIGH** · tall-row · found by the layout check', labels: [{name: 'auto-ui'}, {name: `fp:${id}`}, {name: 'platform:mac'}],
      comments: [{body: 'Fixed by https://github.com/o/r/pull/9 (merged by the UI loop).'}]};
    const gh = args => {
      calls.push(args.join(' '));
      if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify([closed]);
      if (args[0] === 'pr' && args[1] === 'view') return 'abc1234\n';
      if (args[0] === 'api' && /compare\/abc1234\.\.\.3806ebe/.test(args[1])) return `${status}\n`;
      if (args[0] === 'api' && /compare\/3806ebe\.\.\.main/.test(args[1])) return '12\n';
      return args[0] === 'pr' ? '[]' : '';
    };
    return {result: triage({artifacts: dir, runUrl: 'https://x/runs/2', gh, repo: 'o/r', build: 'main @ 3806ebe'}), calls};
  };
  const stale = run('behind');
  assert.deepEqual([stale.result.filed.length, stale.result.stale.length], [0, 1]);
  assert.ok(stale.calls.some(call => /^issue comment 7 --body Seen again in https:\/\/x\/runs\/2 on build `3806ebe`/.test(call)), 'the closed issue is told');
  assert.ok(!stale.calls.some(call => call.startsWith('issue create')), 'no new issue');
  assert.ok(stale.result.dropped.some(item => /stale sighting/.test(item.why)));
  const regression = run('ahead');
  assert.equal(regression.result.filed.length, 1, 'a build that has the fix: filed again');
  assert.ok(regression.calls.some(call => /--label .*regression/.test(call)), 'and labelled a regression');
  assert.ok(regression.calls.some(call => /🧭 the tested build was 12 commits behind main/.test(call)), 'the issue says how far behind main the build was');
});

test('a closed issue carries one resolution label; the verdict maps to it; the stats read it before any guess', () => {
  assert.equal(resolutionOf(issue(['auto-ui', 'resolution:fp:detector'])), 'fp:detector');
  assert.equal(resolutionOf(issue(['resolution:made-up'])), '');
  assert.equal(resolutionForVerdict('harness'), 'fp:harness');
  assert.equal(resolutionForVerdict('false-positive', 'detector'), 'fp:detector');
  assert.equal(resolutionForVerdict('false-positive', 'Probe-Race'), 'fp:probe-race');
  assert.equal(resolutionForVerdict('false-positive', 'stale'), 'stale-sighting');
  assert.equal(resolutionForVerdict('false-positive', ''), 'fp:unknown');
  assert.equal(resolutionForVerdict('real'), '');
  const verdict = parse('false-positive\nWhy: the card is behind the panel.\nCause: detector');
  assert.deepEqual([verdict.word, verdict.cause, verdict.why], ['false-positive', 'detector', 'the card is behind the panel.']);
  const expected = {fixed: 'fixed', 'not-seen': 'unclear', 'fp:harness': 'harness', 'fp:detector': 'falsePositive', 'fp:probe-race': 'falsePositive', 'by-design': 'falsePositive', 'stale-sighting': 'stale', duplicate: 'duplicate'};
  for (const [name, category] of Object.entries(expected)) assert.equal(classify(issue(['auto-ui', labelOf(name)], [], {state: 'CLOSED', stateReason: 'COMPLETED'})), category, name);
  assert.equal(classify(issue(['auto-ui', 'resolution:fixed'], [], {state: 'OPEN'})), 'open', 'an open issue is not fixed because a label says so');
  assert.deepEqual(resolutionCounts([issue(['resolution:fp:detector']), issue(['resolution:fp:detector']), issue(['resolution:fixed']), issue([])]), {'fp:detector': 2, fixed: 1});
  assert.ok(Object.keys(RESOLUTIONS).every(name => RESOLUTIONS[name].length > 10));
});

test('setResolution creates the label once and puts it on the issue; a name it does not know does nothing', () => {
  const calls = [];
  assert.equal(setResolution(args => calls.push(args.join(' ')), 12, 'fixed'), true);
  assert.deepEqual(calls.map(call => call.split(' ').slice(0, 3).join(' ')), ['label create resolution:fixed', 'issue edit 12']);
  assert.equal(setResolution(() => assert.fail('no call'), 12, 'made-up'), false);
});

test('an issue says how far its build was behind main and whether its suite finished; a test step says how recently its suite changed', () => {
  assert.equal(contextLine({behind: 12, incomplete: ['interactions'], suite: 'interactions'}), '🧭 the tested build was 12 commits behind main · its suite did NOT finish (cancelled or timed out): partial results');
  assert.equal(contextLine({behind: 1, incomplete: [], suite: 'focus'}), '🧭 the tested build was 1 commit behind main · its suite finished');
  assert.equal(contextLine({behind: 0}), '🧭 the tested build is main itself');
  assert.equal(contextLine({}), '');
  const now = Date.parse('2026-10-05T12:00:00Z');
  assert.equal(stepAgeLine({last: {sha: 'abcdef1234', date: '2026-10-05T09:00:00Z'}, now}), "🧪 the suite's file last changed 3 h ago (`abcdef1`)");
  assert.equal(stepAgeLine({last: {sha: 'abcdef1', date: '2026-09-28T12:00:00Z'}, now}), "🧪 the suite's file last changed 7 days ago (`abcdef1`)");
  assert.equal(stepAgeLine({last: null, now}), '');
});

test('a producer run is kept as numbers: filed, stale, dropped by reason, behind main, suites that did not finish; many runs add up', () => {
  const result = {findings: [1, 2, 3, 4], filed: [1], again: [2], gone: [], closed: [9], stale: [{id: 'a'}], sameCause: [], behind: 12, dropped: [{why: 'stale sighting: the fix e47ad68 of #275 is newer'}, {why: 'over the 3-new-AI-issues-per-run cap'}, {why: 'matches an issue closed as a false positive'}]};
  const one = runSummary(result, {runUrl: 'https://x/runs/2', build: 'main @ 3806ebe', incomplete: ['interactions'], at: '2026-10-05T12:00:00Z'});
  assert.deepEqual([one.filed, one.stale, one.behind, one.incomplete, one.dropped], [1, 1, 12, ['interactions'], {'stale-sighting': 1, 'over-the-cap': 1, 'known-false-positive': 1}]);
  const total = totalRuns([one, {...one, behind: 40, incomplete: [], dropped: {'over-the-cap': 2}}, null, {v: 2}]);
  assert.deepEqual(total, {runs: 2, filed: 2, stale: 2, held: 0, incompleteRuns: 1, behindMax: 40, dropped: {'stale-sighting': 1, 'over-the-cap': 3, 'known-false-positive': 1},
    paths: {suites: 0, fixed: 0, seeded: 0, steps: 0, failedSteps: 0, windows: {}, zones: {}, themes: {}, events: {}}});
  assert.equal(dropReason('nothing in particular'), 'other');
});

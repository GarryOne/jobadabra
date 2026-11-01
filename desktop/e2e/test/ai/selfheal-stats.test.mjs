// The numbers behind /self-heal: how each issue the loop filed ended, by detector, with precision, the fixer, the cost and the real bugs.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build, classify} from '../../lib/selfheal-stats.mjs';

const issue = (number, state, labels, comments = [], extra = {}) => ({number, state, title: `[auto-ui] x: bug ${number}`, url: `https://github.com/o/r/issues/${number}`, createdAt: '2026-10-10T10:00:00Z',
  labels: labels.map(name => ({name})), comments: comments.map(body => ({body, createdAt: '2026-10-08T12:00:00Z'})), ...extra});

test('each way an issue ends is told apart: fixed, queued, false positive, duplicate, harness, unclear, open', () => {
  assert.equal(classify(issue(1, 'CLOSED', ['source:ai-review', 'wontfix-auto'])), 'falsePositive');
  assert.equal(classify(issue(30, 'CLOSED', ['source:suite-failure', 'harness', 'wontfix-auto'])), 'harness', 'the verdict pass: a test problem is not counted as a false positive');
  assert.equal(classify(issue(2, 'CLOSED', ['source:ai-review'], ['Duplicate of #118 (the same sidebar icon).'])), 'duplicate');
  assert.equal(classify(issue(3, 'CLOSED', ['source:layout-check'], ['Not a product bug: the recall benchmark\'s planted broken image leaked.'])), 'harness');
  assert.equal(classify(issue(4, 'OPEN', ['source:ai-review', 'confirmed'])), 'queued');
  assert.equal(classify(issue(5, 'CLOSED', ['source:ai-review', 'confirmed'])), 'fixed');
  assert.equal(classify(issue(6, 'CLOSED', ['source:code-review'], ['Fixed by 258e752'])), 'fixed');
  assert.equal(classify(issue(7, 'CLOSED', ['source:ai-review'], ['Closed: not seen in two runs in a row.'])), 'unclear');
  assert.equal(classify(issue(8, 'OPEN', ['source:ai-review'])), 'open');
});

test('the snapshot: totals, precision, detectors, fixer (landed by hand counts), cost per real bug, recall, real bugs', () => {
  const issues = [issue(1, 'CLOSED', ['source:ai-review', 'wontfix-auto'], ['Closed by the UI loop as a false positive: ticker']), issue(4, 'OPEN', ['source:ai-review', 'confirmed'], ['Judged real by the UI loop\'s verdict pass (no edits made): x']),
    issue(6, 'CLOSED', ['source:code-review', 'severity:medium'], ['Fixed by 258e752'])];
  const prs = [{state: 'MERGED'}, {state: 'CLOSED', closingNote: 'Landed on main as 73de6d0 after review'}, {state: 'CLOSED', closingNote: 'not right'}, {state: 'OPEN'}];
  const data = build({issues, prs, costs: [{job: 'fixer', usd: 0.5, at: '2026-10-10T09:00:00Z'}, {job: 'verdict of issue 4', usd: 0.1, at: '2026-10-10T09:30:00Z'}], recall: {planted: 13, caught: 12, rows: [{id: 'tiny-text', caught: false}]}, now: new Date('2026-10-09T00:00:00Z')});
  assert.deepEqual([data.totals.filed, data.totals.real, data.totals.fixed, data.totals.queued, data.totals.falsePositive, data.totals.precision], [3, 2, 1, 1, 1, 67]);
  assert.deepEqual(data.fixer, {opened: 4, merged: 1, closed: 2, open: 1, landed: 2});
  assert.deepEqual(data.verdicts, {real: 1, falsePositive: 1});
  assert.deepEqual([data.cost.usd, data.cost.perRealBug, data.cost.byJob], [0.6, 0.3, {fixer: 0.5, verdict: 0.1}]);
  assert.deepEqual(data.recall, {planted: 13, caught: 12, missed: ['tiny-text']});
  assert.deepEqual(data.notable.map(bug => [bug.number, bug.status, bug.detector]), [[6, 'fixed', 'AI code review'], [4, 'queued', 'AI screenshot review']]);
});

test('a person\'s "not planned" closure is a rejection the stats and the weekly review can learn from, with or without the wontfix-auto label', () => {
  assert.equal(classify(issue(40, 'CLOSED', ['source:ai-review'], ['Closed as noise: a cosmetic point.'], {stateReason: 'NOT_PLANNED'})), 'falsePositive');
  assert.equal(classify(issue(41, 'CLOSED', ['source:ai-review', 'confirmed'], ['Rejected as low.'], {stateReason: 'NOT_PLANNED'})), 'falsePositive', 'a confirmed one that was then rejected was not worth fixing');
  assert.equal(classify(issue(42, 'CLOSED', ['source:ai-review'], ['Not seen in two runs: closed.'], {stateReason: 'NOT_PLANNED'})), 'unclear', 'the not-seen rule is not a judgement');
  assert.equal(classify(issue(43, 'CLOSED', ['source:ai-review'], ['Duplicate of #5.'], {stateReason: 'NOT_PLANNED'})), 'duplicate');
});

test('cost per real bug counts only the runs inside the issues\' window, and the snapshot says where the window starts', () => {
  const issues = [issue(4, 'OPEN', ['source:ai-review', 'confirmed']), issue(6, 'CLOSED', ['source:code-review'], ['Fixed by 258e752'])];
  const costs = [{job: 'fixer', usd: 1, at: '2026-10-10T09:00:00Z'}, {job: 'fixer', usd: 8, at: '2026-10-07T09:00:00Z'}, {job: 'verdict', usd: 5}];   // before the epoch; no date
  const data = build({issues, costs, now: new Date('2026-10-10T12:00:00Z')});
  assert.deepEqual([data.cost.usd, data.cost.runs, data.cost.outside, data.cost.perRealBug], [1, 1, 2, 0.5], 'the $8 of 2 Oct is not charged to bugs filed on 5 Oct');
  assert.equal(data.since, '2026-10-09T00:00:00Z');
});

test('issues before the cutoff are counted as excluded, so the page can say how much it leaves out', () => {
  const old = issue(9, 'CLOSED', ['source:suite-failure', 'harness'], [], {createdAt: '2026-10-08T10:00:00Z'});
  const data = build({issues: [old, issue(4, 'OPEN', ['source:ai-review', 'confirmed'])], now: new Date('2026-10-10T12:00:00Z')});
  assert.deepEqual([data.totals.filed, data.excluded], [1, 1]);
});

test('precision counts a test or harness mistake against its detector; a duplicate and an open issue are not judged', () => {
  const issues = [issue(1, 'CLOSED', ['source:suite-failure', 'confirmed']), issue(2, 'CLOSED', ['source:suite-failure', 'harness']), issue(3, 'CLOSED', ['source:suite-failure', 'harness']),
    issue(4, 'CLOSED', ['source:suite-failure'], ['Duplicate of #1.']), issue(5, 'OPEN', ['source:suite-failure'])];
  const data = build({issues, now: new Date('2026-10-10T12:00:00Z')});
  assert.deepEqual([data.totals.real, data.totals.harness, data.totals.duplicate, data.totals.unjudged, data.totals.judged, data.totals.precision], [1, 2, 1, 1, 3, 33]);
});

test('the history is every issue by the day it was filed and how it ended, continuous, not cut at the cutoff', async () => {
  const {dailyHistory} = await import('../../lib/selfheal-stats.mjs');
  const at = (number, date, labels, extra = {}) => ({number, state: 'CLOSED', stateReason: 'COMPLETED', title: `[auto-ui] x: t${number}`, createdAt: `${date}T10:00:00Z`, labels: labels.map(name => ({name})), comments: [], ...extra});
  const history = dailyHistory([at(1, '2026-10-07', ['auto-ui', 'resolution:fixed']), at(2, '2026-10-07', ['auto-ui', 'resolution:fp:detector']), at(3, '2026-10-09', ['auto-ui', 'resolution:stale-sighting']),
    at(4, '2026-10-09', ['auto-ui', 'resolution:fp:harness']), at(5, '2026-10-09', ['auto-ui'], {state: 'OPEN', stateReason: null}), at(6, '2026-10-09', ['auto-ui', 'confirmed'], {state: 'OPEN', stateReason: null})]);
  assert.deepEqual(history.map(row => row.day), ['2026-10-07', '2026-10-08', '2026-10-09'], 'a day with nothing filed is a zero, not a gap');
  assert.deepEqual(history[0], {day: '2026-10-07', filed: 2, real: 1, falsePositive: 1, stale: 0, open: 0});
  assert.deepEqual(history[1], {day: '2026-10-08', filed: 0, real: 0, falsePositive: 0, stale: 0, open: 0});
  assert.deepEqual(history[2], {day: '2026-10-09', filed: 4, real: 1, falsePositive: 1, stale: 1, open: 1});
  assert.deepEqual(dailyHistory([]), []);
  const data = build({issues: [at(1, '2026-10-07', ['auto-ui', 'resolution:fixed'])], costs: [{job: 'fixer', usd: 0.4, at: '2026-10-07T09:00:00Z'}, {job: 'review', usd: 0.1, at: '2026-10-07T11:00:00Z'}, {job: 'x', usd: 1, at: '2026-10-08T09:00:00Z'}], now: new Date('2026-10-10T12:00:00Z')});
  assert.equal(data.history.length, 1);
  assert.deepEqual(data.costDays, {'2026-10-07': 0.5, '2026-10-08': 1}, 'cost per day over every dated run');
});

test('the snapshot carries three periods: all time, the last 7 days and since the cutoff, each with its totals, detectors and cost', async () => {
  const {summarize} = await import('../../lib/selfheal-stats.mjs');
  const at = (number, date, labels, source = 'ai-review') => ({number, state: 'CLOSED', stateReason: 'COMPLETED', title: `[auto-ui] x: t${number}`, createdAt: `${date}T10:00:00Z`, labels: [...labels, `source:${source}`, 'auto-ui'].map(name => ({name})), comments: []});
  const issues = [at(1, '2026-10-07', ['resolution:fixed']), at(2, '2026-10-08', ['resolution:fp:detector'], 'layout-check'), at(3, '2026-10-10', ['resolution:fixed']), at(4, '2026-10-10', ['resolution:stale-sighting'])];
  const costs = [{job: 'review', usd: 1, at: '2026-10-07T09:00:00Z'}, {job: 'review', usd: 2, at: '2026-10-10T09:00:00Z'}];
  const data = build({issues, costs, now: new Date('2026-10-14T12:00:00Z')});
  assert.deepEqual([data.periods.all.totals.filed, data.periods.all.totals.real, data.periods.all.totals.falsePositive, data.periods.all.totals.stale, data.periods.all.totals.precision], [4, 2, 1, 1, 67]);
  assert.deepEqual([data.periods.last7.totals.filed, data.periods.last7.totals.real], [3, 1], '9 Oct minus 7 days is 2 Oct 12:00: the issue of 2 Oct 10:00 is out; 3 Oct and both of 5 Oct are in');
  assert.deepEqual([data.periods.cutoff.totals.filed, data.periods.all.cost.usd, data.periods.cutoff.cost.usd, data.periods.cutoff.cost.perRealBug], [2, 3, 2, 2], 'cost counts the same window as the issues');
  assert.deepEqual(data.periods.all.byDetector.map(row => [row.detector, row.filed]), [['AI screenshot review', 3], ['Layout and DOM checks', 1]]);
  assert.deepEqual(summarize([]).totals.precision, null);
});

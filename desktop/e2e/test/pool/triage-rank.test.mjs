// The fixer (ui-fix.yml, once a day) picks the most critical finding: severity times how often it came back in the last 7 days, a person's "confirmed" doubling it.
// A finding seen again and again in a week is real; a one-off AI remark never gets to the top.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CONFIRMED, NOT_SEEN, pickCandidate, readinessSummary, recentSightings, score} from '../../lib/triage.mjs';

const NOW = Date.parse('2026-10-10T08:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString();
const issue = (number, {severity = 'MEDIUM', kind = 'layout', created = 1, again = [], labels = []} = {}) => ({number, state: 'OPEN', createdAt: day(created),
  body: `**${severity}** · ${kind} · found by the AI screenshot review`, labels: [{name: 'auto-ui'}, {name: `fp:f${number}`}, ...labels.map(name => ({name}))],
  comments: again.map(age => ({body: 'Seen again in run x', createdAt: day(age)}))});

test('recent sightings count the issue itself and the "seen again" comments of the last 7 days', () => {
  assert.equal(recentSightings(issue(1, {created: 2, again: [1, 3, 5]}), NOW), 4);
  assert.equal(recentSightings(issue(1, {created: 20, again: [1, 9, 15]}), NOW), 1, 'only the comment of day 1 is in the window; the old issue itself is not');
  assert.equal(recentSightings({number: 1, comments: [], body: ''}, NOW), 1, 'an issue without dates counts once');
});

test('the score is severity times recent sightings, doubled by a person\'s confirmation', () => {
  assert.equal(score(issue(1, {severity: 'HIGH', again: [1, 2]}), NOW), 3 * 3);
  assert.equal(score(issue(1, {severity: 'LOW', created: 1}), NOW), 1);
  assert.equal(score(issue(1, {severity: 'MEDIUM', labels: [CONFIRMED]}), NOW), 2 * 1 * 2);
});

test('the most critical goes first: a frequent medium beats a rare high, the oldest breaks a tie', () => {
  const frequent = issue(5, {severity: 'MEDIUM', again: [1, 2, 3, 4]});   // 2 x 5 = 10
  const rareHigh = issue(6, {severity: 'HIGH', again: [1]});              // 3 x 2 = 6
  assert.equal(pickCandidate([rareHigh, frequent], {now: NOW})?.number, 5);
  const a = issue(7, {again: [1]}), b = issue(8, {again: [2]});           // both 2 x 2
  assert.equal(pickCandidate([b, a], {now: NOW})?.number, 7);
});

test('a finding that came back only long ago is not ready (the old rule of two sightings is about the same week)', () => {
  assert.equal(pickCandidate([issue(9, {created: 30, again: [20]})], {now: NOW}), null, 'two sightings, none this week: it is stale');
  assert.equal(pickCandidate([issue(9, {created: 30, again: [20, 2, 1]})], {now: NOW})?.number, 9, 'two sightings this week');
});

import {chooseCandidate} from '../../triage.mjs';
test('the fixer reads the open issues and the open fix branches and chooses without filing anything', () => {
  const calls = [];
  const issues = [issue(5, {severity: 'MEDIUM', again: [1, 2]}), issue(6, {severity: 'HIGH', again: [1]})];
  const gh = args => { calls.push(args.slice(0, 2).join(' ')); return args[0] === 'issue' ? JSON.stringify(issues) : JSON.stringify([{headRefName: 'auto-fix/f5'}]); };
  const picked = chooseCandidate({gh, now: NOW});
  assert.equal(picked.number, 6, 'the first one has an open fix branch already');
  assert.deepEqual(calls, ['issue list', 'pr list'], 'it only reads');
});

test('the fixer\'s summary says how many findings are open, which are ready, why each other one was passed over, and the rules, in real lines', () => {
  const issues = [issue(1, {again: [2]}), issue(2), issue(3, {again: [2], labels: [NOT_SEEN]}), issue(4, {again: [2], kind: 'test-failure'}), issue(5, {labels: ['needs-human']})];
  const text = readinessSummary(issues, {now: NOW, candidate: pickCandidate(issues, {now: NOW})});
  assert.equal(text.includes('\\n'), false, 'no literal \\n: the summary is markdown with real line breaks');
  assert.match(text, /^## UI fixer\n/);
  assert.match(text, /\*\*Fixing #1\*\*/);
  assert.match(text, /5 open finding\(s\) · 1 ready/);
  assert.match(text, /Ready \(most critical first\) \| 1 \| #1 \|/);
  assert.match(text, /Seen fewer than 2 times this week[^|]*\| 1 \| #2 \|/);
  assert.match(text, /Clean in the latest run[^|]*\| 1 \| #3 \|/);
  assert.match(text, /does not take[^|]*\| 1 \| #4 \|/);
  assert.match(text, /Parked[^|]*\| 1 \| #5 \|/);
  assert.match(text, /The rules[\s\S]*at least 2 commits in the last 7 days/);
  assert.doesNotMatch(text, /To have one fixed now/, 'a fix is under way: no suggestions');
  const none = readinessSummary([issue(2)], {now: NOW});
  assert.match(none, /\*\*Nothing is ready to fix\.\*\* 1 open finding\(s\), none passed the rules below/);
  assert.match(none, /To have one fixed now:[\s\S]*label it `confirmed`[\s\S]*gh issue edit 2 --add-label confirmed && gh workflow run ui-fix\.yml/);
  assert.match(none, /lower the bar[\s\S]*SIGHTINGS_NEEDED[\s\S]*now 2/);
  assert.match(none, /\| Status \| Count \| Issues \| To have it picked \|/);
});

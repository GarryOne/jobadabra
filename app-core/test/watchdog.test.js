// The GitHub-side watchdog of the Worker's on-time starts (6 Oct 2026: a Worker without secrets started nothing for a day, and GitHub showed no sign of it).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {TITLES} from '../src/scheduler.js';
import {dueStarts, fires, issueBody, keyOf, missingStarts, recoveredComment, ROUND_STALE_MIN, roundFromIssue, staleRound, startedAt} from '../src/watchdog.js';

const at = iso => new Date(iso);

test('the due starts are the latest of each workflow, by the Worker\'s own crons and rules', () => {
  assert.equal(fires('40 */3 * * *', at('2026-10-06T09:40:00Z')), true);
  assert.equal(fires('40 */3 * * *', at('2026-10-06T10:40:00Z')), false);
  assert.equal(fires('47 21,23,1 * * *', at('2026-10-06T23:47:00Z')), true);
  const due = dueStarts(at('2026-10-06T12:05:00Z'));
  assert.deepEqual(due.map(item => [item.workflow, item.at]), [
    ['desktop.yml', '2026-10-06T02:00:00.000Z'],   // 04:00 Zurich in summer; the 03:00 UTC firing starts nothing
    ['e2e.yml', '2026-10-06T01:47:00.000Z'],
    ['e2e.yml', '2026-10-06T05:30:00.000Z'],   // the night burn-in's 5th pass is a start of its own: it does not replace the three-a-day one
    ['self-heal-stats.yml', '2026-10-06T09:40:00.000Z'],
  ]);
  assert.equal(dueStarts(at('2026-10-06T12:50:00Z')).find(item => item.workflow === 'self-heal-stats.yml').at, '2026-10-06T09:40:00.000Z', 'the 12:40 slot is younger than the grace: not judged yet');
  assert.equal(dueStarts(at('2026-12-06T12:05:00Z')).find(item => item.workflow === 'desktop.yml').at, '2026-12-06T03:00:00.000Z', 'in winter 03:00 UTC is 04:00 Zurich');
});

test('a start is its run when titled so, or dispatched in the minutes after the slot; 6 Oct 2026 had none', () => {
  const due = {workflow: 'self-heal-stats.yml', at: '2026-10-06T09:40:00.000Z'};
  assert.equal(startedAt(due, [{createdAt: '2026-10-06T06:51:20Z', event: 'schedule', displayTitle: 'CI · Self-heal stats'}]), null, 'GitHub\'s late backup run is not the on-time start');
  assert.ok(startedAt(due, [{createdAt: '2026-10-06T09:40:04Z', event: 'workflow_dispatch', displayTitle: TITLES['self-heal-stats.yml']}]));
  assert.ok(startedAt(due, [{createdAt: '2026-10-06T09:41:00Z', event: 'workflow_dispatch', displayTitle: 'CI · Self-heal stats'}]), 'a dispatch before the titles existed still counts');
  assert.equal(startedAt(due, [{createdAt: '2026-10-06T10:05:00Z', event: 'workflow_dispatch', displayTitle: 'CI · Self-heal stats'}]), null, 'too late to be the slot\'s');
  const runsOf = {'desktop.yml': [], 'e2e.yml': [{createdAt: '2026-10-06T10:17:10Z', event: 'workflow_run', displayTitle: 'Beta E2E tests x'}], 'self-heal-stats.yml': []};
  const missing = missingStarts(dueStarts(at('2026-10-06T12:05:00Z')), runsOf);
  assert.deepEqual(missing.map(item => item.workflow), ['desktop.yml', 'e2e.yml', 'e2e.yml', 'self-heal-stats.yml']);
  const body = issueBody(missing, {checked: '2026-10-06T12:05:00Z', runUrl: 'https://x/runs/1'});
  assert.match(body, /did not start these 4 runs on time/);
  assert.match(body, /\| `e2e\.yml` night pass 5\/5 \| 2026-10-06 05:30 UTC \| `\*\/10 \* \* \* \*` \|/);
  assert.match(body, /\| `e2e\.yml` \| 2026-10-06 01:47 UTC \| `47 21,23,1 \* \* \*` \|/);
  assert.match(body, /npx wrangler secret list/);
  assert.ok(body.includes(`<!-- watchdog-missing: ${keyOf(missing)} -->`), 'the body names what it reported, so an unchanged state is not commented again');
  assert.match(recoveredComment([{workflow: 'e2e.yml', at: '2026-10-06T13:47:00.000Z'}], {'e2e.yml': [{createdAt: '2026-10-06T13:47:03Z', event: 'workflow_dispatch', url: 'https://x/r/2'}]}), /\[started\]\(https:\/\/x\/r\/2\)/);
});

test('each workflow shows the title the scheduler gives its on-time start', () => {
  const file = name => fs.readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
  for (const [workflow, title] of Object.entries(TITLES)) assert.ok(file(workflow).includes(`'${title}'`), `${workflow} run-name says '${title}'`);
  assert.match(file('self-heal-stats.yml'), /inputs:\n\s+scheduled:/, 'the stats workflow takes the input the Worker sends (an undeclared one is refused: 422)');
});

test('the probe round is one more missing start only when its newest stored round is older than 45 min; an unreadable or empty answer is not judged', () => {
  const now = at('2026-11-01T12:00:00Z');
  assert.equal(ROUND_STALE_MIN, 45);
  assert.equal(staleRound({at: '2026-11-01T11:20:00Z'}, now), null, '40 min old: still on time');
  const stale = staleRound({at: '2026-11-01T10:50:00Z'}, now);
  assert.deepEqual([stale.round, stale.workflow, stale.at], [true, 'synthetic-probe-round', '2026-11-01T10:50:00Z']);
  for (const unread of [null, undefined, {}, {at: null}, {at: 'not a date'}, {at: 5}]) assert.equal(staleRound(unread, now), null, JSON.stringify(unread));
});

test('the issue names the stale round and its tab; the check list is only for starts; the key does not change while the same round stays stale', () => {
  const round = staleRound({at: '2026-11-01T10:50:00Z'}, at('2026-11-01T12:00:00Z'));
  const only = issueBody([round], {checked: '2026-11-01T12:23:00Z'});
  assert.match(only, /The site Worker's probe rounds stopped/);
  assert.match(only, /none stored since 2026-11-01 10:50 UTC/);
  assert.match(only, /Synthetic Monitoring tab/);
  assert.doesNotMatch(only, /did not start|wrangler secret list/, 'no start is missing: the start checklist would send the reader the wrong way');
  const both = issueBody([{workflow: 'e2e.yml', cron: '47 21,23,1 * * *', at: '2026-11-01T01:47:00.000Z'}, round], {checked: '2026-11-01T12:23:00Z'});
  assert.match(both, /did not start this run on time/);
  assert.match(both, /wrangler secret list/);
  assert.match(both, /probe rounds/);
  assert.equal(keyOf([round]), keyOf([staleRound({at: '2026-11-01T10:50:00Z'}, at('2026-11-01T14:00:00Z'))]), 'two hours later the same stale round gives the same key: no new comment');
});

test('a round the read could not judge keeps what the open issue says about it: the same key, never "recovered" (Gitar on #2895)', () => {
  const round = staleRound({at: '2026-11-01T10:50:00Z'}, at('2026-11-01T12:00:00Z')), body = issueBody([round], {checked: '2026-11-01T12:23:00Z'});
  const kept = roundFromIssue(body);
  assert.equal(keyOf([kept]), keyOf([round]), 'carried over, the key is unchanged: no edit, no comment, no close');
  assert.equal(kept.round, true);
  assert.equal(roundFromIssue(issueBody([{workflow: 'e2e.yml', cron: '47 21,23,1 * * *', at: '2026-11-01T01:47:00.000Z'}], {checked: '2026-11-01T12:23:00Z'})), null, 'an issue about starts only has no round to keep');
  for (const none of [undefined, null, '', 'no marker']) assert.equal(roundFromIssue(none), null);
});

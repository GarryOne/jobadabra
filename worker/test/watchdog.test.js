// The GitHub-side watchdog of the Worker's on-time starts (6 Oct 2026: a Worker without secrets started nothing for a day, and GitHub showed no sign of it).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {TITLES} from '../src/scheduler.js';
import {dueStarts, fires, issueBody, keyOf, missingStarts, recoveredComment, startedAt} from '../src/watchdog.js';

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

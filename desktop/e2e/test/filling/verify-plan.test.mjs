// verify-plan.mjs: a fix is replayed only against a recording made before it, a regression only when an older recording got further. Pure: no browser, no git.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {plan} from '../../verify-plan.mjs';

const at = day => `2026-10-${day}T10:00:00.000Z`;
const record = (day, outcome) => ({dir: `r/${day}`, at: at(day), startMs: Date.parse(at(day)), log: '', outcome});
const stuck = {reached: 'account', filled: null, left: null}, far = {reached: 'form', filled: 8, left: 2};
const history = {commits: [{hash: 'abc', at: at('01')}], versions: []};

test('a fix is replayed against the newest recording before it; with only a later recording, on the build before the fix; with none, Needs a recording now', () => {
  const rows = new Map([['a', [record('10', stuck), record('13', far)]], ['b', [record('13', stuck)]]]);
  const ledger = [{site: 'a', commit: 'aaa1111', landedAt: at('12')}, {site: 'b', commit: 'bbb2222', landedAt: at('12')}, {site: 'c', commit: 'ccc3333', landedAt: at('12')}];
  const {jobs, verdicts} = plan({rows, ledger, history});
  assert.deepEqual(jobs.map(job => [job.kind, job.row, job.record.dir, job.beforeBuild]), [['fixed', 'a', 'r/10', undefined], ['fixed', 'b', 'r/13', 'bbb2222^']]);
  assert.deepEqual(verdicts.map(item => [item.row, item.verdict, item.why]), [['c', 'live', 'no recording of this row']]);
});

test('a regression is replayed only when an older recording got further than the newest', () => {
  const rows = new Map([['x', [record('10', far), record('13', stuck)]], ['y', [record('10', stuck), record('13', far)]], ['z', [record('13', stuck)]]]);
  const {jobs} = plan({rows, ledger: [], history});
  assert.deepEqual(jobs.map(job => [job.kind, job.row, job.record.dir, job.older.dir]), [['regression', 'x', 'r/13', 'r/10']]);
});

test('too many rows at once: the rest say so instead of silently dropping', () => {
  const rows = new Map(Array.from({length: 25}, (_, index) => [`r${index}`, [record('10', far), record('13', stuck)]]));
  const {jobs, verdicts} = plan({rows, ledger: [], history});
  assert.equal(jobs.length, 20);
  assert.equal(verdicts.length, 5);
});

test('records are grouped by row, oldest first, with their folder relative to the records and a git history that finds versions', async () => {
  const {default: fs} = await import('node:fs'), {default: os} = await import('node:os'), {default: path} = await import('node:path');
  const {mainHistory, recordsByRow} = await import('../../lib/verify-records.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-records-'));
  for (const [dir, startMs] of [['mac/b', 2000], ['123/a', 1000]]) { fs.mkdirSync(path.join(root, dir), {recursive: true}); fs.writeFileSync(path.join(root, dir, 'record.json'), JSON.stringify({name: 'Row', url: 'https://x.test/', startMs, entries: []})); }
  const rows = recordsByRow(root);
  assert.deepEqual(rows.get('Row').map(item => [item.rel, item.outcome]), [['123/a', null], ['mac/b', null]]);
  const git = (...args) => (args[0] === 'log' && args.includes('extension') ? 'h1 2026-10-10T00:00:00Z\nh2 2026-10-11T00:00:00Z\n' : args[0] === 'log' ? 'h1 2026-10-10T00:00:00Z\nh2 2026-10-11T00:00:00Z\nh3 2026-10-12T00:00:00Z\n' : '{"version": "0.9"}');
  assert.deepEqual(mainHistory(git).versions, [{version: '0.9.1', hash: 'h1', at: '2026-10-10T00:00:00Z'}, {version: '0.9.2', hash: 'h2', at: '2026-10-11T00:00:00Z'}]);
});

test('only: just the named rows are planned and answered; the others are left alone', () => {
  const rows = new Map([['a', [record('10', stuck)]], ['b', [record('10', stuck)]], ['c', [record('10', far), record('13', stuck)]]]);
  const ledger = [{site: 'a', commit: 'aaa1111', landedAt: at('12')}, {site: 'b', commit: 'bbb2222', landedAt: at('12')}, {site: 'z', commit: 'zzz9999', landedAt: at('12')}];
  const some = plan({rows, ledger, history, only: ['b', 'z']});
  assert.deepEqual(some.jobs.map(job => job.row), ['b']);
  assert.deepEqual(some.verdicts.map(item => item.row), ['z'], 'a named row with no recording still gets its verdict; a row not named gets none');
  assert.deepEqual(plan({rows, ledger, history, only: ['c']}).jobs.map(job => `${job.kind}:${job.row}`), ['regression:c']);
  assert.equal(plan({rows, ledger, history}).jobs.length, 3, 'no list: every row as before (a and b fixed, c regression)');
});

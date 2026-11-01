// Guards lib/replay-time.mjs without a browser: a case's fill time read from its fill record, and the PR's fill times against main's (fail on a median +1 s).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compareFill, fillSeconds} from '../../lib/replay-time.mjs';

const run = (host, started, ended, tail = '') => ({route: '/extension/run', body: `{"url":"https://${host}/apply","started":"${started}","ended":"${ended}","fields":3${tail}`});

test('a case\'s fill time: its last fill record on its own host, read even from a body cut short', () => {
  const requests = [run('a.example', '2026-10-13T10:00:00.000Z', '2026-10-13T10:00:04.500Z'), {route: '/extension/log', body: '{}'},
    run('b.example', '2026-10-13T10:00:00.000Z', '2026-10-13T10:00:09.000Z'), run('a.example', '2026-10-13T10:00:10.000Z', '2026-10-13T10:00:12.250Z', ',"trace":[{"label":"cut')];
  assert.equal(fillSeconds(requests, ['a.example']), 2.25);
  assert.equal(fillSeconds(requests, ['b.example']), 9);
  assert.equal(fillSeconds(requests, ['c.example']), null);
  assert.equal(fillSeconds([{route: '/extension/run', body: '{"url":"https://a.example/x","started":"bad"'}], ['a.example']), null);
});

const rows = (pairs) => pairs.map(([name, fill]) => ({name, fill}));

test('the PR is slower when the median of its per-case differences is +1 s or more', () => {
  const main = rows([['a', 2], ['b', 3], ['c', 4], ['d', 5], ['e', 6]]);
  const same = compareFill(rows([['a', 2.2], ['b', 2.9], ['c', 4.1], ['d', 5], ['e', 6.4]]), main);
  assert.equal(same.slower, false);
  assert.equal(same.cases, 5);
  const slow = compareFill(rows([['a', 3.5], ['b', 4.2], ['c', 5.1], ['d', 5], ['e', 6.4]]), main);
  assert.equal(slow.slower, true);
  assert.equal(slow.median, 1.1);
  assert.deepEqual(slow.worst.map(one => one.name), ['a', 'b', 'c']);
});

test('too few cases in both, or no baseline: nothing to judge, said, never a failure', () => {
  assert.deepEqual(compareFill(rows([['a', 9]]), rows([['a', 1]])), {slower: false, cases: 1, median: null, worst: [], why: 'only 1 case(s) with a fill time in both runs (5 needed)'});
  assert.equal(compareFill(rows([['a', 9], ['b', 9], ['c', 9], ['d', 9], ['e', 9]]), []).why, 'only 0 case(s) with a fill time in both runs (5 needed)');
  assert.equal(compareFill(rows([['a', null], ['b', 3]]), rows([['a', 1], ['b', 3]])).cases, 1);   // a case without a fill (no form) is not compared
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {byDay, collectChanges, kindOf, parseLog, sizeOf} from '../../lib/finder-changes.mjs';

const LOG = `@@aaa1111|2026-10-04T10:00:00+02:00|Finder: hold findings about code that moved
120\t10\tdesktop/e2e/lib/triage-hold.mjs
30\t0\tdesktop/e2e/test/triage-hold.test.mjs
@@bbb2222|2026-10-04T12:00:00+02:00|Strategy suite: baseline role
5\t1\tdesktop/e2e/suites/strategy.mjs
@@ccc3333|2026-10-05T09:00:00+02:00|Tests for the hold
40\t0\tdesktop/e2e/test/x.test.mjs
-\t-\tdesktop/e2e/fixtures/shot.png
`;

test('a file is rules, suite or tests; a size is by the lines of rules and suite code, tests not counted', () => {
  assert.equal(kindOf('desktop/e2e/lib/a.mjs'), 'rules');
  assert.equal(kindOf('desktop/e2e/suites/a.mjs'), 'suite');
  assert.equal(kindOf('desktop/e2e/test/a.test.mjs'), 'tests');
  assert.equal(kindOf('desktop/e2e/fixtures/judge-exam/a.json'), 'tests');
  assert.deepEqual([0, 59, 60, 299, 300].map(sizeOf), ['tests only', 'small', 'medium', 'medium', 'large']);
});

test('the log is read per commit, a binary file counts as a file but no lines', () => {
  const [a, b, c] = parseLog(LOG);
  assert.deepEqual([a.sha, a.day, a.rules, a.tests, a.size], ['aaa1111', '2026-10-04', 130, 30, 'medium']);
  assert.deepEqual([b.suite, b.size], [6, 'small']);
  assert.deepEqual([c.lines, c.size, c.files], [0, 'tests only', 2]);
});

test('days add up their changes and name the biggest first; a failing git gives an empty list, not a crash', () => {
  const days = byDay(parseLog(LOG), {top: 1});
  assert.equal(days.length, 2);
  assert.deepEqual([days[0].day, days[0].commits, days[0].lines, days[0].size, days[0].more], ['2026-10-04', 2, 136, 'medium', 1]);
  assert.equal(days[0].items[0].sha, 'aaa1111');
  assert.deepEqual(collectChanges({run: () => { throw new Error('no git'); }}), []);
  assert.equal(collectChanges({run: () => LOG}).length, 2);
});

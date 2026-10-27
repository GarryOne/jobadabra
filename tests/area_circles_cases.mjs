// Cases for tools/area-circles.mjs, run by tests/test_area_circles.py (the python suite starts on tools/**, the desktop one would not): the circle counter counts fix PRs per area, flags 2+ in 7 days, and stays silent for an area with no fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
const NOW = Date.UTC(2026, 9, 27), DAY = 86400e3;
const c = (hash, daysAgo, subject, files) => ({hash, time: NOW - daysAgo * DAY, subject, files});
const load = () => import('../tools/area-circles.mjs');

test('counts distinct PRs touching the changed files, by window', async () => {
  const {priorPrs} = await load();
  const commits = [c('a1', 0, 'Keep the dim (#2262)', ['x.js']), c('a2', 1, 'Keep the dim again (#2262)', ['y.js']), c('b1', 2, 'Steady flicker', ['x.js']),
    c('c1', 20, 'Repair the panel (#2100)', ['x.js']), c('e1', 1, 'Other area (#2201)', ['z.js'])];
  assert.deepEqual(priorPrs(commits, ['x.js'], 7, NOW).map(pr => pr.id), ['#2262', 'b1']);
  assert.deepEqual(priorPrs(commits, ['x.js', 'y.js'], 30, NOW).map(pr => pr.id), ['#2262', 'b1', '#2100']);
});

test('the panel dim scenario (no "fix" in any subject) is a circle with a machine-readable last line', async () => {
  const {report} = await load();
  const files = ['extension/panel-overlay.js', 'extension/early-dim.js'];
  const commits = [c('0d0327b', 0, 'Keep the panel centred and dimmed while working', [files[0]]), c('be1c238', 0, 'Keep the working panel steady', [files[1]]),
    c('16acd70', 0, 'Free the page the moment the fill writes its end', [files[0]]), c('f2262', 0, 'Dim once (#2262)', files)];
  const lines = report(commits, [...files, 'desktop/test/panel.test.js', 'docs/x.md'], NOW);
  assert.match(lines.join('\n'), /circle: 4 earlier PRs on these files in 7 days \(if they were fixes, this PR is fix number 5\)/);
  assert.equal(lines.at(-1), 'AREA-CIRCLES 7d=4 30d=4 files=extension/panel-overlay.js,extension/early-dim.js');
});

test('one earlier PR is no circle; no earlier PR (or only tests/docs shared) is silent', async () => {
  const {report} = await load();
  const one = report([c('a1', 3, 'Change x (#1)', ['x.js'])], ['x.js'], NOW);
  assert.ok(!one.join('\n').includes('circle:'));
  assert.equal(one.at(-1), 'AREA-CIRCLES 7d=1 30d=1 files=x.js');
  assert.deepEqual(report([c('b1', 40, 'Old (#2)', ['x.js']), c('b2', 1, 'Docs (#3)', ['docs/a.md'])], ['x.js', 'docs/a.md'], NOW), []);
});

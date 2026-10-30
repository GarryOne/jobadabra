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
  assert.deepEqual(report([c('b1', 40, 'Old (#2)', ['x.js']), c('b2', 1, 'Docs (#3)', ['docs/a.md'])], ['x.js', 'docs/a.md'], NOW), ['AREA-CIRCLES 7d=0 30d=0 files=x.js'], 'no earlier PR: the counter says 0 itself');
});

test('three earlier harness code PRs in seven days are a circle', async () => {
  const {report} = await load();
  const files = ['desktop/e2e/lib/context.mjs'];
  const commits = [c('a1', 1, 'Repair context (#1)', files), c('b1', 3, 'Repair context again (#2)', files),
    c('c1', 6, 'Repair context once more (#3)', files)];
  const lines = report(commits, files, NOW);
  assert.equal(lines.at(-1), 'AREA-CIRCLES 7d=3 30d=3 files=desktop/e2e/lib/context.mjs');
  assert.ok(lines.some(line => line.startsWith('circle:')));
});

test('shared e2e tests and golden fixtures never count as an area', async () => {
  const {report} = await load();
  const files = ['desktop/e2e/test/x.test.mjs', 'desktop/e2e/fixtures/golden/a.json'];
  const commits = [c('a1', 1, 'Update fixtures (#1)', files), c('b1', 2, 'Update tests (#2)', files)];
  assert.deepEqual(report(commits, files, NOW), ['AREA-CIRCLES 7d=0 30d=0 files=']);
});

test('harness suites and root scripts count while shared registries and non-code evidence stay excluded', async () => {
  const {report} = await load();
  const files = ['desktop/e2e/suites/settings.mjs', 'desktop/e2e/run-all.mjs', 'desktop/e2e/test-sets.json', 'desktop/e2e/lanes.json', 'desktop/e2e/timing-baseline.json',
    'desktop/e2e/tests/x.mjs', 'desktop/e2e/recorded/a.json', 'desktop/e2e/docs/a.json', 'desktop/e2e/README.md',
    'desktop/e2e/lib/x.test.mjs', 'desktop/e2e/package-lock.json'];
  const lines = report([c('a1', 1, 'Update harness (#1)', files)], files, NOW);
  assert.equal(lines.at(-1), 'AREA-CIRCLES 7d=1 30d=1 files=desktop/e2e/suites/settings.mjs,desktop/e2e/run-all.mjs');
});

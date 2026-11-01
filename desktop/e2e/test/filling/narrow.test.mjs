// The narrow-window pass (lib/layout.mjs visitNarrow): resizes, visits, downgrades what it finds to warnings, always restores the size.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SWEEP, sweep, visitNarrow} from '../../lib/layout.mjs';
import {expectedFor} from '../../lib/vision.mjs';

function fakeCtx({railed = true} = {}) {
  const calls = {sizes: [], clicks: [], zooms: []};
  const ctx = {findings: [], app: {evaluate: async (_fn, size) => { if (typeof size === 'number') { calls.zooms.push(size); return 0.8; } calls.sizes.push(size); return [1280, 820]; }},
    page: {waitForFunction: async () => { if (!railed) throw new Error('timeout'); }, click: async selector => { calls.clicks.push(selector); }, locator: () => ({first: () => ({isVisible: async () => true})})}};
  return {ctx, calls};
}

test('it visits each page at 1024 px, files what it finds as warnings and puts the window back', async () => {
  const {ctx, calls} = fakeCtx();
  const take = async (c, name) => { c.findings.push({view: name, severity: 'severe', kind: 'page-overflow', detail: 'x'}); };
  await visitNarrow(ctx, ['focus', 'jobs'], {take});
  assert.deepEqual(calls.sizes, [[1024, 640], [1280, 820]]);
  assert.deepEqual(calls.clicks, ['.nav[data-view="focus"]', '.nav[data-view="jobs"]']);
  assert.deepEqual(ctx.findings.map(f => [f.view, f.severity]), [['focus-narrow', 'warning'], ['jobs-narrow', 'warning']], 'a narrow-only problem never fails a journey');
});

test('the window is restored even when a page cannot be photographed', async () => {
  const {ctx, calls} = fakeCtx();
  await assert.rejects(visitNarrow(ctx, ['focus'], {take: async () => { throw new Error('boom'); }}), /boom/);
  assert.deepEqual(calls.sizes.at(-1), [1280, 820]);
});

test('a sidebar that does not become a rail is a finding, not a crash', async () => {
  const {ctx} = fakeCtx({railed: false});
  await visitNarrow(ctx, [], {take: async () => {}});
  assert.match(ctx.findings[0].detail, /did not become an icon rail at 1024 px/);
});

test('the AI review judges a narrow page against the same expectation as the wide one', () => {
  assert.equal(expectedFor('jobs-narrow'), expectedFor('jobs'));
});

// The sweep (4 Oct 2026): every page at several sizes and both themes with the deterministic checks only, once per page/kind/element, then the window and the theme are put back.
test('the sweep visits every page at every size and theme, tells each finding once with where it was seen, and restores the window and the theme', async () => {
  const sizes = [], themes = [], clicks = [];
  let current = '';
  const ctx = {findings: [], app: {evaluate: async (_fn, size) => { sizes.push(size); return [1280, 820]; }},
    page: {locator: () => ({first: () => ({isVisible: async () => true})}), click: async selector => { clicks.push(selector); current = selector; }, waitForTimeout: async () => {},
      evaluate: async (fn, arg) => {
        if (arg?.limits) return current.includes('"jobs"') ? [{view: 'jobs', severity: 'warning', kind: 'hidden-scroll', detail: '"Settings" is cut off at this window size and nothing shows it scrolls'}] : [];
        if (typeof arg === 'string') { themes.push(arg); return arg; }
        return 'system';
      }}};
  await sweep(ctx, ['focus', 'jobs'], {combos: [[1024, 640, 'light'], [1024, 640, 'dark'], [1920, 1080, 'light']], settleFn: async () => true});
  assert.equal(clicks.length, 6, 'two pages at three combinations');
  assert.deepEqual(sizes.slice(-1)[0], [1280, 820], 'the window is put back');
  assert.deepEqual(themes, ['light', 'dark', 'light', 'system'], 'each theme was set, then the original one restored');
  assert.equal(ctx.findings.length, 1, 'the same finding at three sizes is told once');
  assert.match(ctx.findings[0].detail, /\[seen at 1024x640, light theme\]$/);
  assert.equal(ctx.findings[0].severity, 'warning');
  assert.ok(SWEEP.some(([w, h]) => w === 1024 && h === 640), 'the real sweep includes the app\'s smallest window');
});

// 22 Oct 2026 (#1170): the app opens at 80% on displays up to 1512 pt, so 1024 window px were 1280 CSS px and the rail never showed. The pass looks at 100% zoom.
test('the narrow pass and the sweep look at 100% zoom (window px = CSS px) and put the user zoom back', async () => {
  const {ctx, calls} = fakeCtx();
  await visitNarrow(ctx, ['focus'], {take: async () => {}});
  assert.deepEqual(calls.zooms, [1, 0.8], 'zoom 100% while narrow, then the original factor');
  const swept = {sizes: [], zooms: []};
  const sctx = {findings: [], app: {evaluate: async (_fn, arg) => { if (typeof arg === 'number') { swept.zooms.push(arg); return 0.8; } swept.sizes.push(arg); return [1280, 820]; }},
    page: {locator: () => ({first: () => ({isVisible: async () => true})}), click: async () => {}, waitForTimeout: async () => {}, evaluate: async (_fn, arg) => (arg?.limits ? [] : 'system')}};
  await sweep(sctx, ['focus'], {combos: [[1024, 640, 'light']], settleFn: async () => true});
  assert.deepEqual(swept.zooms, [1, 0.8]);
});

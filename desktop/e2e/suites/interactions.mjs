/* global window */
// Interactions: what each safe control of every page DOES when pressed. A click that changes nothing and reaches nothing, an expandable that does not expand, an action that
// runs seconds with no sign of work and a click that throws are found from recorded behaviour (page changes, the window's calls to the app, errors), not from a picture.
// Nothing that deletes, sends, signs in, leaves the app or spends AI credit is ever pressed (lib/interact.mjs isSafe). Starts from a set-up install.
import fs from 'node:fs';
import path from 'node:path';
import {finish, sweep, visitNarrow} from '../lib/layout.mjs';
import {WINDOW_SIZES, createVariation} from '../lib/variation.mjs';
import {probePage} from '../lib/interact.mjs';
import {goTo as goToPage} from '../lib/leave-prompt.mjs';
import {ensureSetUp, seedCoverage} from '../lib/seed.mjs';
import {settle} from '../lib/app.mjs';
import {VIEWS} from '../lib/uicheck.mjs';
import {measureRecall, recallFindings} from '../lib/recall.mjs';
import {lateShiftFindings, nowInPage, shiftsIn, watchShifts} from '../lib/shift.mjs';
import {goView} from '../lib/go-view.mjs';
import {probe, problems} from '../lib/rail-markers.mjs';

export const macos = true;   // runs on a macOS runner: pixels, fonts and window sizes: judged on the Mac people use (lib/plan.mjs runnerOf)
export const name = 'interactions';
// One failed step never hides the rest: the runner records it and goes on (lib/runner.mjs); only the setup steps marked `critical` stop the suite.
export const keepGoing = true;
// A seeded run visits every page from another time zone and language (lib/variation.mjs placeOf): the truth and layout checks see dates and numbers as a person there would.
export const variesPlace = true;
export const minutes = 25;   // was 10: the suite grew (sweeps of sizes, themes, time zones, the late-shift watch) and was cancelled at 10 min in two gate runs in a row (5 Oct 2026), its partial findings filed as issues
// The engine's coverage answer takes seconds on a real machine (the owner's: about 5): a card that arrives that late must not move the page (lib/shift.mjs, #strategy-coverage-checking).
export const env = {JOB_PILOTTO_E2E_COVERAGE_MS: '4500'};
// A suite that walks a different seeded path on each scheduled run (lib/variation.mjs). Exploring runs on an unchanged commit run only these: the other suites would repeat themselves.
export const varies = true;
export const watches = ['desktop/renderer/', 'desktop/lib/e2e-ipc.js'];

export async function run(ctx) {
  const {page, app, ARTIFACTS} = ctx;
  ctx.findings = [];
  const all = [];
  ctx.replayPath = {pages: [], pressed: []};   // the probe's own path, kept in replay.json for every issue it files (lib/replay.mjs)
  await ensureSetUp(ctx);
  seedCoverage(ctx);   // the search has been run before: the Strategy page has its "too narrow" card to show
  // The calls the window made to the app, recorded by main.js in an end-to-end run (lib/e2e-ipc.js).
  const ipc = {
    mark: () => app.evaluate(() => (globalThis.__jpIpc || []).at(-1)?.seq || 0),
    since: mark => app.evaluate((_electron, from) => (globalThis.__jpIpc || []).filter(call => call.seq > from).map(({channel, start, ms, failed}) => ({channel, start, ms, failed})), mark),
  };
  let shots = 0;
  // A different path on every scheduled run (E2E_SEED, lib/variation.mjs): the pages in another order, the controls in another order, another window size.
  // The release gate runs with no seed: the same path every time.
  const vary = createVariation();
  const size = vary.pick(WINDOW_SIZES);
  if (!vary.fixed) await app.evaluate(({BrowserWindow}, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), size);
  fs.writeFileSync(path.join(ARTIFACTS, 'seed.json'), JSON.stringify({seed: vary.seed, fixed: vary.fixed, window: size, ...(ctx.place ? {detail: `time zone ${ctx.place.zone}, language ${ctx.place.locale}`} : {})}));
  console.log(vary.fixed ? '  variation: fixed path' : `  variation: seed ${vary.seed}, window ${size.join('x')}; replay with E2E_SEED=${vary.seed}`);
  // A page that has finished loading stays still (lib/shift.mjs): content that appears by itself seconds later and pushes the page down is a finding. Each page is watched untouched for STILL_MS.
  const STILL_MS = 7000;
  await page.evaluate(watchShifts);
  for (const view of VIEWS) {
    await ctx.run(`${view}: stays still once it has loaded`, async () => {
      await goView(page, view);
      await settle(page);
      const since = await page.evaluate(nowInPage);
      await page.waitForTimeout(STILL_MS);
      if (view === 'strategy') console.log(`  strategy: the coverage verdict is ${JSON.stringify(await page.evaluate(() => window.pilot.searchCoverage()).catch(error => String(error.message))).slice(0, 200)}; its card is ${await page.locator('#strategy-coverage').isVisible() ? 'shown' : 'not shown'}`);
      const record = await page.evaluate(shiftsIn), late = lateShiftFindings({view, since, shifts: record});
      const after = record.filter(item => item.at >= since);
      console.log(`  ${view}: ${after.length} layout shift(s) after it was ready${after.length ? ` (${after.map(item => `${((item.at - since) / 1000).toFixed(1)}s score ${item.value.toFixed(3)}${item.input ? ' by input' : ''} ${item.node}`).join('; ')})` : ''}`);
      for (const item of late) console.log(`  ! [${view}] ${item.kind}: ${item.detail}`);
      ctx.findings.push(...late);
    }, {needs: ctx.needs});
  }
  if (process.env.E2E_ONLY_STILL) return;   // a by-hand check of this one detector: skip the rest of the suite
  const goTo = view => goToPage(page, view);   // answers Strategy's unsaved-edits prompt (lib/leave-prompt.mjs)
  for (const view of vary.shuffle(VIEWS)) {
    await ctx.run(`${view}: every safe control does something`, async () => {
      await goTo(view);
      await settle(page);
      const {results, findings, skipped} = await probePage({page, view, ipc, scope: `.view[data-view="${view}"]`, arrange: vary.shuffle, reset: async () => { await goView(page, view); await settle(page); },
        onFlag: async (_control, flagged) => { const shot = `probe-${view}-${++shots}`; await ctx.session.shot(`ui-${shot}`); for (const item of flagged) item.shot = shot; }});
      all.push(...results.map(item => ({...item, view})));
      ctx.replayPath.pages.push(view);
      ctx.replayPath.pressed.push(...results.map(item => ({view, name: item.control, effects: (item.effects || []).join(', '), flagged: !!item.rechecked})));
      ctx.findings.push(...findings);
      console.log(`  ${view}: ${results.length} controls pressed, ${findings.length} flagged, ${skipped.length} left alone (${skipped.slice(0, 6).join(' | ')})`);
    }, {needs: ctx.needs});
  }
  // Recall (lib/recall.mjs): known bugs planted into the page one at a time; each detector must catch its own. A miss is filed as a finding about the detector.
  await ctx.run('the detectors catch the bugs planted for them (recall)', async () => {
    await goTo('focus');
    await settle(page);
    const result = await measureRecall({page, view: 'focus', ipc});
    fs.writeFileSync(path.join(ARTIFACTS, 'recall.json'), JSON.stringify(result, null, 2));
    ctx.findings.push(...recallFindings(result));
    console.log(`  recall: ${result.caught} of ${result.planted} planted bugs caught${result.caught < result.planted ? ` (missed: ${result.rows.filter(row => !row.caught).map(row => row.id).join(', ')})` : ''}`);
  }, {needs: ctx.needs});
  await ctx.run('the narrowest window: the sidebar is an icon rail and every page still fits', async () => {
    await visitNarrow(ctx, ['focus', 'jobs', 'actions', 'settings']);
  }, {needs: ctx.needs});
  await ctx.run('every page at four window sizes and in both themes: nothing is cut off, unreachable or broken (no screenshots, no AI)', async () => {
    await sweep(ctx, ['focus', 'jobs', 'actions', 'calendar', 'interviews', 'strategy', 'settings', 'sessions']);
  }, {needs: ctx.needs});
  await ctx.run('the icon rail: every badge and dot sits inside its button, clear of the icon', async () => {
    const resize = size => ctx.app.evaluate(({BrowserWindow}, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; const was = win.getSize(); win.setSize(w, h); return was; }, size);
    const was = await resize([1024, 640]);
    try {
      await ctx.page.click('.nav[data-view="jobs"]');
      const bad = problems(await ctx.page.evaluate(probe));
      if (bad.length) throw new Error(bad.join('; '));
    } finally {
      await resize(was);
    }
  }, {needs: ctx.needs});
  fs.writeFileSync(path.join(ARTIFACTS, 'interactions.json'), JSON.stringify(all, null, 2));
  await ctx.run('interaction findings are written', async () => {
    if (!all.length) throw new Error('the probe pressed no control on any page: it found nothing to test');
    finish(ctx);
  }, {needs: ctx.needs});
}

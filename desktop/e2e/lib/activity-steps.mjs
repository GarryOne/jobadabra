/* global document, window */
// What the two activity suites (activity, activityfailures) share: reading the Actions page and Recent activity the way a person sees them, running a task and counting
// its rows, the feed the engine reads, and the common start (a set-up install, its own run rows cleared, no schedule, the app quiet). The suites themselves are in suites/.
import fs from 'node:fs';
import path from 'node:path';
import {badSummary, leaks, sample} from './activity.mjs';
import {clearData} from './start-state.mjs';
import {snap} from './layout.mjs';
import {ensureSetUp} from './seed.mjs';
import {pressTask} from './task-card.mjs';

export const RUNS_DB = 'Cronjob Runs';

// ---------- reading the app ----------
export const runsData = page => page.evaluate(async () => {
  const data = await window.pilot.runs();
  return {running: data.running ? {kind: data.running.kind || '', step: data.running.step || '', live: !!data.running.live, where: data.running.where || 'mac'} : null,
    queued: (data.queued || []).map(item => ({kind: item.kind})), historyLoaded: !!data.historyLoaded, busy: data.busy || [],
    runs: (data.runs || []).map(run => ({id: run.id, kind: run.kind, ok: run.ok, off: !!run.off, warned: !!run.warned, trigger: run.trigger, where: run.where, result: run.result || '',
      summary: run.summary || '', problem: run.problem || '', log: run.log || [], notionUrl: run.notionUrl || '', startedAt: run.startedAt, endedAt: run.endedAt || ''}))};
});
// The Recent runs list on the Actions page as a person reads it, newest first: {kind, pill, result}.
export const shownRows = page => page.evaluate(() => [...document.querySelectorAll('#runs-table .runs-row')].map(row => ({id: row.dataset.runId || '', kind: row.querySelector('b')?.textContent || '',
  pill: row.querySelector('.ui-pill, .pill')?.textContent?.trim() || '', result: row.querySelector('.runs-result')?.textContent?.trim() || ''})));
// How the Recent runs list names each kind of task.
export const LABEL = {search: 'Find jobs', mail: 'Gmail check', weekly: 'Search analysis', scout: 'More employers'};
// The Recent runs list once it shows this run (the page redraws on the app's next poll, a moment after the run ended).
export async function shownWith(page, id, maxMs = 25000) {
  const started = Date.now();
  let rows = await shownRows(page);
  while (!rows.some(row => row.id === String(id)) && Date.now() - started < maxMs) { await page.waitForTimeout(1000); rows = await shownRows(page); }
  return rows;
}
export const sleep = (page, ms) => page.waitForTimeout(ms);

// This suite turns its own schedule off, so a "schedule" row is someone else's: on a Mac the suites share one Notion page (CI gives each its own), and another session's
// app may be running its schedule into it. Rows by a schedule are ignored here.
// Which of these runs are this app's. A Notion row with no local record may be another app's (CI and a Mac use the same page when a token is shared), so it is ignored,
// unless it is the very same Notion page as one of this app's runs: then the app lists one run twice, which is a bug.
export const pageId = url => String(url || '').replace(/-/g, '').match(/[0-9a-f]{32}$/i)?.[0] || '';
export function own(runs) {
  const ids = new Set(runs.filter(run => run.log.length && run.notionUrl).map(run => pageId(run.notionUrl)));
  return {mine: runs.filter(run => run.log.length), twice: runs.filter(run => !run.log.length && ids.has(pageId(run.notionUrl)))};
}
// Clicks a task's Run button on the Actions page and waits until its run has ended (nothing running, nothing waiting) -> {fresh: the runs it added, seconds}.
export async function runTask(ctx, command, {maxMs = 240000, kind} = {}) {
  const {page} = ctx;
  await page.click('.nav[data-view="actions"]');
  const before = new Set((await runsData(page)).runs.map(run => run.id));
  const started = Date.now();
  await pressTask(page, `[data-command="${command}"]`);
  let data, seen = false;
  const samples = [];   // what a person could see while it ran (the live log above all): liveLogProblems()
  while (Date.now() - started < maxMs) {
    await sleep(page, 1500);
    data = await runsData(page);
    if (data.running) samples.push(await sample(page).catch(() => null));
    const {mine, twice} = own(data.runs.filter(run => !before.has(run.id) && run.trigger !== 'schedule' && (!kind || run.kind === kind)));
    if (twice.length) throw new Error(`the app lists one run twice: its own record and the same Notion page again (${twice.map(run => run.kind).join(', ')})`);
    const added = mine;
    seen = seen || !!data.running || added.length > 0;
    if (seen && !data.running && !data.queued.length && added.length) return {fresh: added, data, shown: await shownWith(page, added[0].id), seconds: Math.round((Date.now() - started) / 1000), samples: samples.filter(Boolean)};
  }
  throw new Error(`the ${command} task was still ${data?.running ? 'running' : 'not finished'} after ${Math.round(maxMs / 1000)} s`);
}

// Chooses an entry of the open menu with a click event, not a mouse click: Playwright scrolls an element into view first, and any scroll closes the menu (renderer/components.js),
// so on the small window of a CI Mac the item vanished under the click ("element is not visible").
export const chooseMenu = (page, text) => page.locator('.ui-menu button', {hasText: text}).dispatchEvent('click');

// Opens a run from the Actions page's Recent runs (the newest row of that kind) and reads what the panel shows a person; then closes it.
export async function openRun(ctx, label, {inPanel = false, id, snapAs, situation, untilResult = false} = {}) {
  const {page} = ctx;
  await page.click('.nav[data-view="actions"]');
  if (inPanel) {   // an older run: the Actions page lists only the newest five, so find it through the panel's filter
    await openPanel(ctx);
    await page.click('#activity-filter');
    await chooseMenu(page, new RegExp(`^${label}`));
    await sleep(page, 500);
    await page.locator('#activity-recent .recent-row').first().click();
  } else {
    await (id ? page.locator(`#runs-table .runs-row[data-run-id="${id}"]`) : page.locator('#runs-table .runs-row').filter({has: page.locator('b', {hasText: new RegExp(`^${label}$`)})}).first()).click();
  }
  await page.waitForFunction(runPanelShown, null, {timeout: 10000});
  await sleep(page, 1500);   // a run read from Notion fetches its page for the log
  // The pill is drawn from the run's log: while the app still says it reads it from Notion the pill says "Completed" for a run the list calls "With warnings" (beta 12, CI: 25 s+ behind the start-up reads). Wait for the reading to end, not a longer sleep.
  await page.waitForFunction(() => !/Reading from Notion|Waiting for the log/.test(document.getElementById('log')?.textContent || ''), null, {timeout: 40000}).catch(() => {});   // a log that never arrives is the step's own finding
  // A page read is two Notion calls that wait their turn behind the app's start-up reads (25 s+ seen): wait for the result instead of a fixed look (6 Oct 2026: the step looked before the read ended).
  if (untilResult) await page.waitForFunction(() => ['activity-card', 'activity-message', 'activity-result', 'activity-warnings'].some(id => { const node = document.getElementById(id); return node && !node.hidden && node.textContent.trim(); }), null, {timeout: 90000}).catch(() => {});
  const seen = await page.evaluate(() => {
    const text = id => (document.getElementById(id)?.hidden ? '' : document.getElementById(id)?.textContent || '').replace(/\s+/g, ' ').trim();
    return {title: text('activity-selected'), status: text('activity-status'), warningsTitle: text('activity-warnings-title'), warnings: text('activity-warnings-summary'),
      warningList: text('activity-warnings-list'), result: text('activity-result'), message: text('activity-message'), card: text('activity-card'), log: document.getElementById('log')?.textContent || ''};
  });
  // The state behind an empty pane, read before the panel closes: a failing step prints it (the pane alone says nothing about which run, page or error).
  seen.state = await page.evaluate(async () => {
    const data = await window.pilot.runs();
    return {runs: (data.runs || []).length, historyLoaded: !!data.historyLoaded, selectedRow: document.querySelector('#activity-recent .recent-row.current')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) || null,
      weekly: (data.runs || []).filter(run => run.kind === 'weekly').slice(0, 2).map(run => ({id: run.id, pageId: run.pageId || null, where: run.where, message: !!run.message, log: (run.log || []).length})),
      activity: window.__activity?.(), cardHidden: document.getElementById('activity-card')?.hidden, panelEmpty: document.getElementById('activity-panel')?.dataset.emptyResult || null};
  });
  // The nightly UI loop looks at these screenshots (layout checks and the AI review): the states where a UI goes wrong are the failure ones.
  if (snapAs) await snap(ctx, snapAs, {view: 'actions', situation});
  await closeRunPanel(page);
  return seen;
}

// After a (re)launch: the window is up and the app has read its history and has nothing to do.
export async function appReady(ctx) {
  await ctx.page.waitForSelector('.view:not([hidden])', {timeout: 60000});
  await quiet(ctx, {forMs: 3000, maxMs: 240000});
}

// The rows of the open Recent activity panel as a person sees them: {kind, what, state}.
export const panelRows = page => page.evaluate(() => [...document.querySelectorAll('#activity-recent .recent-row')].map(row => ({kind: row.querySelector('.run-kind')?.textContent || '',
  what: row.querySelector('.run-what')?.textContent?.replace(/\s+/g, ' ').trim() || '', state: row.dataset.state || ''})));
// Actions → Runs (owner, 25 Oct 2026: every run in the app, the drawer shows one): the link to all runs opens the tab with the run list and the run panel.
export async function openPanel(ctx) {
  const {page} = ctx;
  await page.click('.nav[data-view="actions"]');
  await page.click('#runs-all');
  await page.waitForFunction(() => !document.getElementById('actions-runs')?.hidden && !!document.querySelector('#actions-runs .ap-grid'), null, {timeout: 10000});
  await sleep(page, 800);
}
// The one run panel is on screen, in the drawer or in Actions → Runs.
export const runPanelShown = () => !!document.querySelector('.ap-detail')?.offsetParent;
// Leave it: the drawer closes; Actions → Runs goes back to Tasks.
export async function closeRunPanel(page) {
  if (await page.evaluate(() => !document.getElementById('activity-panel')?.hidden)) await page.click('#activity-close');
  else await page.click('[data-actions-tab="tasks"]');
}
// Search rows this app started (a "schedule" row is someone else's, see runTask).
export const searchRows = async (page, before) => { const {mine, twice} = own((await runsData(page)).runs.filter(run => run.kind === 'search' && run.trigger !== 'schedule' && !before.has(run.id))); return [...mine, ...twice]; };
export const idsNow = async page => new Set((await runsData(page)).runs.map(run => run.id));

// The feed the engine reads: these postings, nothing else (an empty list means a search finds nothing new and asks the AI nothing).
let nextId = Math.floor(Date.now() / 1000);   // new in every run of the suite: a posting seen by an earlier run (its Job Matches row stays in Notion) is not new
export function setFeed(ctx, titles = [], {location = 'Zurich, Switzerland or Amsterdam, Netherlands'} = {}) {
  // The titles say both "Site Reliability Engineer" and "Data Analyst": the roles a wizard-built page searches for, and the example's (a page whose Search settings were not built from the CV).
  const jobs = titles.map(title => { const id = nextId++; title = `${title} (Site Reliability / Data Analyst)`; return {id, title, location: {name: location}, absolute_url: `https://boards.e2e.test/job/${id}`, updated_at: '2026-10-02T09:00:00Z',
    content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, hybrid in Zurich, English working language.</p>`}; });
  fs.writeFileSync(path.join(ctx.feeds, 'acme.json'), JSON.stringify({jobs}));
  fs.writeFileSync(path.join(ctx.feeds, 'beta.json'), JSON.stringify({jobs: []}));
  return jobs;
}

// What a person is told about a run, plus what must be true of every run.
export function problemsWith(ctx, run, {label, shown}) {
  const found = [];
  const words = shown?.result ?? '';   // the line on the page, not a field of the data: the page is what a person reads
  const bad = badSummary(words);
  if (bad) found.push(`${label}: the summary line is wrong: ${bad}`);
  const log = run.log.join('\n');
  if (!run.log.length) found.push(`${label}: the Technical log is empty`);
  const secrets = [ctx.appKey, ctx.token];
  for (const leak of leaks(`${log}\n${words}`, {secrets, dirs: [ctx.profile, ctx.feeds]})) found.push(`${label}: the log or summary shows ${leak}`);
  return found;
}

// No row of this suite's run history may stay "Running" once the app says nothing runs. Waits a little: the engine closes its row a moment after the app sees the end.
// Read through the store the app uses (cron_runs, ctx.data): this Mac's or Notion's ⏱️ Search runs.
export async function noRowStaysRunning(ctx, {allow = 0, waitMs = 45000} = {}) {
  const started = Date.now();
  let rows;
  do {
    rows = ((await ctx.data('cron_runs', 'list', {})) || []).filter(row => row.status === 'Running' && !/schedule/i.test(row.trigger || ''));
    if (rows.length <= allow) return;
    await sleep(ctx.page, 3000);
  } while (Date.now() - started < waitMs);
  throw new Error(`${rows.length} run row(s) in the store are still "Running" with nothing running: ${rows.map(row => `"${row.title}" (${String(row.summary || '').slice(0, 40)})`).join('; ')}`);
}

// Waits until the app has shown nothing running, nothing queued and its history loaded for `forMs` in a row.
export async function quiet(ctx, {forMs, maxMs}) {
  const started = Date.now();
  let since = null, data;
  while (Date.now() - started < maxMs) {
    data = await runsData(ctx.page);
    // busy: the app's own start-up work (the move into Notion): its engine steps take the run lock, so a run started now would wait for them (beta 3, 26 Oct 2026).
    const idle = !data.running && !data.queued.length && data.historyLoaded && !data.busy.length;
    since = idle ? since ?? Date.now() : null;
    if (since && Date.now() - since >= forMs) return data;
    await sleep(ctx.page, 2000);
  }
  throw new Error(`the app was still busy after ${Math.round(maxMs / 1000)} s of waiting for quiet: running=${JSON.stringify(data?.running)} queued=${data?.queued.length} historyLoaded=${data?.historyLoaded} busy=${JSON.stringify(data?.busy)}`);
}


// `page` always means the window of the app running now: some steps start the app again (ctx.relaunch).
export const livePage = ctx => new Proxy({}, {get: (_, key) => { const value = ctx.page[key]; return typeof value === 'function' ? value.bind(ctx.page) : value; }});

// The common start of both suites.
export async function prepare(ctx) {
  const page = livePage(ctx);
  ctx.findings = [];
  console.log(`  profile ${ctx.profile}, feeds ${ctx.feeds}`);
  await ctx.run('this suite starts with no run rows in its store', async () => {
    console.log(`  cleared ${await clearData(ctx, RUNS_DB)} run row(s)`);
  }, {needs: ctx.needs, critical: true});
  // Every run seeds postings with new ids (setFeed), so each leaves Job Matches rows behind: 491 piled up by 6 Oct 2026 and a run spent 5 minutes marking them Not seen.
  await ctx.run('this suite starts with no job rows in its store\'s Job Matches', async () => {
    console.log(`  cleared ${await clearData(ctx, 'Job Matches — AI Scored')} job row(s)`);
  }, {needs: ctx.needs});
  await ensureSetUp(ctx);
  fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
  fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'sources.json'), path.join(ctx.profile, 'config', 'sources.json'));
  fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'scout_seeds.json'), path.join(ctx.profile, 'config', 'scout_seeds.json'));
  setFeed(ctx, []);
  await ctx.run('the app is quiet before the first task: no schedule, no first search, its history read', async () => {
    // A set-up install's first search (pressed on the Find jobs card) and a schedule that catches up what is due: neither belongs in a count of "one click, one row".
    await page.evaluate(() => window.pilot.saveSettings({autoSearch: false, schedule: {search: 0, mail: 0, scout: 'off', insights: 'off'}}));
    await quiet(ctx, {forMs: 8000, maxMs: 300000});
  }, {needs: ctx.needs, critical: true});
  return page;
}

/* global document */
// Actions + Recent activity: every task on the Actions page (one row, an end, plain words, a clean log, nothing left Running) and the Recent activity screen itself (filter,
// the link to all runs (Actions → Runs), a finished run's result card, a run read only from Notion). Starts from a set-up install; resets only its own run rows in Notion.
// What goes WRONG (the AI failing, two things at once, a quit in the middle) is the activityfailures suite, in parallel, on its own Notion page.
import fs from 'node:fs';
import path from 'node:path';
import {badSummary, leaks, liveLogProblems} from '../lib/activity.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {journey} from '../lib/journey.mjs';
import {LABEL, appReady, chooseMenu, closeRunPanel, noRowStaysRunning, openPanel, openRun, runPanelShown, panelRows, prepare, problemsWith, runTask, runsData, sleep} from '../lib/activity-steps.mjs';

export const minutes = 15;
// What a step needs from an earlier one when E2E_STEPS picks it (lib/runner.mjs wantedWords): the relaunch steps read a weekly run, and the filter shows only with two runs.
export const stepNeeds = {'without its message': ['Analyze my job search', 'Find jobs'], 'read only from Notion': ['Analyze my job search', 'Find jobs']};
export const name = 'activity';
// One failed step never hides the rest: the runner records it and goes on (lib/runner.mjs); only the setup steps marked `critical` stop the suite.
export const keepGoing = true;
// The app reads Notion's run history every 15 s and picks up the jobs of the last session 20 s after launch: both shortened for the journey (never for a user).
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};   // this suite breaks things on purpose: its Sentry reports are tagged expected
// The Actions page's answer to the task that just ended: waits for it, reads what form it is in, and gives it the same checks every screen gets (layout, raw text,
// "a carded run shown as text"). Before 5 Oct 2026 the page was checked once, after all tasks, so each result had been replaced by the next one before anyone looked:
// a finished Search analysis showed as raw Telegram text and no check ever saw it.
async function inspectResult(ctx, task) {
  const {page} = ctx;
  await page.waitForFunction(() => ['actions-result', 'command-answer'].some(id => { const box = document.getElementById(id); return box && !box.hidden; }), null, {timeout: 15000}).catch(() => {});
  const shown = await page.evaluate(() => ({card: !!document.querySelector('#actions-result:not([hidden]) #actions-card > *'),
    text: document.getElementById('command-answer')?.hidden ? '' : (document.getElementById('command-answer')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160)}));
  await snap(ctx, `actions-result-${task.command}`, {view: 'actions'});
  return shown;
}

export async function run(ctx) {
  const page = await prepare(ctx);
  // ---------- (1) every task card ----------
  const TASKS = [
    // announces: the line the finder says as it starts its work (src/scout.py run()), now the last step of Find jobs: on the fixtures it ends in seconds, too fast for the
    // live-log timer, so a finder that printed none of its steps passed (#352, the scout-silent mutant). Its own sentence, checked in the finished search's log.
    {command: 'run', kind: 'search', what: 'Find jobs (an empty feed: nothing new)', maxMs: 240000, announces: /Scout: checking \d+ employer/},
    {command: 'mail', kind: 'mail', what: 'Check Gmail & Calendar with no Google connection', maxMs: 120000},
    {command: 'weekly', kind: 'weekly', what: 'Analyze my job search', maxMs: 240000},
  ];
  ctx.taskRuns = {};
  // A seeded run presses the cards in another order (each is checked on its own): a run that only passes after another one, or leaves something behind
  // for the next, shows up. No seed (the release gate) = the order above. Replay: E2E_SEED=<seed> node suite.mjs activity.
  const order = ctx.vary.shuffle(TASKS);
  if (!ctx.vary.fixed) {
    console.log(`  variation: seed ${ctx.vary.seed}; tasks in order ${order.map(task => task.command).join(', ')}`);
    fs.mkdirSync(ctx.ARTIFACTS, {recursive: true});
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'seed.json'), JSON.stringify({seed: ctx.vary.seed, fixed: false, detail: `tasks: ${order.map(task => task.command).join(', ')}`}));
  }
  for (const task of order) {
    await ctx.run(`${task.what}: one Recent runs row, an end, plain words, a clean log, and no row left Running`, async () => {
      const {fresh, shown, seconds, samples} = await runTask(ctx, task.command, {maxMs: task.maxMs, kind: task.kind});
      const mine = shown.find(row => row.id === String(fresh[0].id));
      if (!mine) throw new Error(`the Actions page's Recent runs shows no row for the run that just ended (it shows: ${shown.map(row => row.kind).join(', ')})`);
      const own = fresh.filter(run => run.kind === task.kind);
      console.log(`  ${task.command}: ${fresh.length} row(s) [${fresh.map(run => `${run.kind}:${run.ok ? 'ok' : 'failed'}`).join(', ')}] in ${seconds}s; "${mine?.result.slice(0, 90)}" [${mine?.pill}]`);
      if (own.length !== 1 || fresh.length !== 1) throw new Error(`expected exactly one new Recent runs row of kind ${task.kind}, got ${fresh.length} (${fresh.map(run => `${run.kind} by ${run.trigger} at ${run.startedAt}`).join(', ') || 'none'})`);
      if (process.env.E2E_DEBUG) console.log(JSON.stringify({shown: mine, log: own[0].log.slice(0, 40), ok: own[0].ok, result: own[0].result, summary: own[0].summary}, null, 1));
      const problems = [...problemsWith(ctx, own[0], {label: task.command, shown: mine}), ...liveLogProblems(samples, {label: task.what})];
      if (task.announces && !task.announces.test([].concat(own[0].log || []).join('\n'))) problems.push(`${task.what} never said what it was doing: its log has no "${task.announces.source}" line`);
      if (problems.length) throw new Error(problems.join('; '));
      ctx.taskRuns[task.command] = own[0];
      await noRowStaysRunning(ctx);
      const result = await inspectResult(ctx, task);
      console.log(`  ${task.command}: the Actions page shows ${result.card ? 'a card' : result.text ? `text "${result.text.slice(0, 60)}"` : 'nothing'}`);
      // The report has a card of its own (renderer/pages/activity.js cardFor): the same one Recent activity draws, never the chat message it was written as.
      if (task.command === 'weekly' && !result.card) throw new Error(`the Actions page shows the finished Search analysis as text, not as its card: "${result.text || 'nothing at all'}"`);
    }, {needs: ctx.needs});
  }
  // Removed 6 Oct 2026: "Find new employers with a slow AI still streams its live log". On the fixtures the scout asks the AI nothing (it reads the boards), so a slow AI
  // never slowed it: the step passed or failed on step order alone. Find new employers' own task step above still checks its row, its end and its log.
  // ---------- (4) Recent activity itself ----------
  // Before the failure tests: the history keeps about the newest 25 runs, and after the tests below the first tasks have scrolled out of it.
  await ctx.run('The link to all runs opens Actions → Runs, and its task filter keeps one kind of run at a time', async () => {
    await openPanel(ctx);
    const all = await panelRows(page);
    if (!/^\d+$/.test((await page.textContent('#activity-count')).trim())) throw new Error('Runs does not count its runs');
    // The panel lists a page of the newest runs; the filter menu lists every kind in the whole history, with how many.
    await page.click('#activity-filter');
    const entries = await page.locator('.ui-menu button').allTextContents();
    console.log(`  panel rows: ${all.length}; filter menu: ${entries.join(' | ')}`);
    for (const wanted of [LABEL.search, LABEL.mail, LABEL.weekly]) {
      if (!entries.some(entry => entry.replace(/^✓ /, '').startsWith(`${wanted} ·`))) throw new Error(`the filter has no "${wanted}" entry although that task ran`);
    }
    await chooseMenu(page, new RegExp(`^${LABEL.mail}`));
    await sleep(page, 500);
    const mailOnly = await panelRows(page);
    if (!mailOnly.length || mailOnly.some(row => row.kind !== LABEL.mail)) throw new Error(`the Gmail filter shows: ${mailOnly.map(row => row.kind).join(', ') || 'nothing'}`);
    await page.click('#activity-filter');
    await chooseMenu(page, /^(✓ )?Any task/);
    await sleep(page, 500);
    if ((await panelRows(page)).length < all.length) throw new Error('"All runs" did not bring the other runs back');
    await snap(ctx, 'activity-panel', {view: 'actions', situation: 'Actions → Runs after many runs'});
    await closeRunPanel(page);
  }, {needs: ctx.needs});

  await ctx.run('opening a finished run shows its result card and its Technical log', async () => {
    const opened = await openRun(ctx, LABEL.weekly, {inPanel: true, untilResult: true});
    const words = `${opened.message} ${opened.card} ${opened.result}`.trim();
    console.log(`  weekly: result "${words.slice(0, 100)}"; log ${opened.log.split('\n').filter(Boolean).length} line(s)`);
    if (words.length < 20) throw new Error(`the finished search analysis shows no result ("${words}")`);
    if (badSummary(words.slice(0, 200))) throw new Error(`its result is wrong: ${badSummary(words.slice(0, 200))}`);
    if (/^(Nothing to show yet|No log for this run)/.test(opened.log.trim()) || !opened.log.trim()) throw new Error('its Technical log is empty');
  }, {needs: ctx.needs});

  await ctx.run('clicking the pop-up of a finished task opens that task\'s result in Recent activity', async () => {
    const {page} = ctx;
    const selected = () => page.evaluate(() => (document.getElementById('activity-selected')?.textContent || '').replace(/\s+/g, ' ').trim());
    await page.click('.nav[data-view="actions"]');
    await page.click('[data-command="mail"]');   // the quick, free task (no Google connection): its pop-up is the news that the run ended (renderer/pages/activity.js announceRuns)
    const popup = page.locator('.toast.toast-link').filter({hasText: new RegExp(LABEL.mail, 'i')}).first();
    await popup.waitFor({timeout: 180000});
    // Look at an older run first and leave the panel open on it: the panel would show the new run by itself (it is the latest), so only the click can switch it.
    await page.locator('#runs-table .runs-row').filter({hasNot: page.locator('b', {hasText: new RegExp(`^${LABEL.mail}$`)})}).first().click();   // the Actions page lists the newest five
    await page.waitForFunction(runPanelShown, null, {timeout: 10000});
    const before = await selected();
    if (!before || new RegExp(LABEL.mail, 'i').test(before)) throw new Error(`the test could not open an older run first (the panel shows "${before}")`);
    await popup.click();   // the pop-up is still on screen: they last 8 s
    await page.waitForFunction(label => (document.getElementById('activity-selected')?.textContent || '').includes(label), LABEL.mail, {timeout: 5000})
      .catch(async () => { throw new Error(`the pop-up opened the run panel on "${await selected()}", not on the run it announced (${LABEL.mail})`); });
    await closeRunPanel(page);
  }, {needs: ctx.needs});

  // 5 Oct 2026: a run sent to Telegram (--send) leaves no message in this Mac's record; the report lives on its Notion page only.
  // With Always on off, the Search analysis opened to an empty pane. Same record, message stripped: the result must still be drawn.
  await ctx.run('a run recorded on this Mac without its message still shows its result from the Notion page', async () => {
    await ctx.relaunch({}, profile => {
      const file = path.join(profile, 'runs.json');
      const runs = JSON.parse(fs.readFileSync(file, 'utf8')).map(run => ({...run, message: null, report: undefined}));
      fs.writeFileSync(file, JSON.stringify(runs));
    });
    await appReady(ctx);
    // untilResult: after a relaunch the page read waits behind the start-up reads (CI 6 Oct 2026: answered with the result, after the step had looked at 1.5 s).
    const opened = await openRun(ctx, LABEL.weekly, {inPanel: true, untilResult: true});
    // The report drawn from the page (its card or message), not the list's one-line result: that line is there without the page, so a run that never read its
    // page passed (#353, the local-run-skips-notion-page mutant).
    const words = `${opened.message} ${opened.card}`.trim();
    if (words.length < 20) throw new Error(`a local run without its message opens to no result ("${words}"): its Notion page is not read. State: ${JSON.stringify(opened.state)}; page errors: ${[...journey.pageErrors, ...journey.consoleErrors].slice(-3).join(' | ') || 'none'}`);
    if (!opened.log.trim()) throw new Error('reading the Notion page replaced the run\'s own log with nothing');
  }, {needs: ctx.needs});

  await ctx.run('a run read only from Notion (a fresh start, no local record) still shows its log', async () => {
    const restartedAt = Date.now();
    await ctx.relaunch({}, profile => fs.rmSync(path.join(profile, 'runs.json'), {force: true}));
    await appReady(ctx);
    const data = await runsData(page);
    // A run recorded BEFORE the restart that still has a log means the record was not removed. A run the new app started itself (its catch-up checks begin a few seconds after launch,
    // and carry a log) is not: judged by "any run with a log" this step failed on timing alone (2 of 5 runs on 5 Oct 2026).
    const kept = data.runs.filter(run => run.log.length && !(Date.parse(run.startedAt) >= restartedAt));
    if (kept.length) throw new Error(`the local run record was not removed: this would test nothing (runs from before the restart with a log: ${kept.map(run => `${run.kind || 'search'} by ${run.trigger} at ${run.startedAt}, ${run.log.length} line(s)`).join('; ')})`);
    if (!data.runs.length) throw new Error('the history read from Notion is empty after a fresh start');
    // Waits for the page read (7 Oct 2026: on CI it took 1.9-4.7 s, and the step looked at 1.5 s; the app had read 17 lines, the pane still said "No log for this run").
    const opened = await openRun(ctx, LABEL.weekly, {inPanel: true, untilResult: true});
    const lines = opened.log.split('\n').filter(Boolean).length;
    console.log(`  from Notion: ${data.runs.length} run(s); weekly log ${lines} line(s)`);
    if (/^(Nothing to show yet|No log for this run)/.test(opened.log.trim()) || !lines) throw new Error('a run read from Notion shows no log');
    for (const leak of leaks(opened.log, {secrets: [ctx.appKey, ctx.token], dirs: [ctx.profile, ctx.feeds]})) throw new Error(`a Notion run's log shows ${leak}`);
  }, {needs: ctx.needs});

  await ctx.run('the Actions page and Recent runs render without layout problems after every task', async () => {
    await snap(ctx, 'activity-after-tasks', {view: 'actions'});
    finish(ctx);
  }, {needs: ctx.needs});
}

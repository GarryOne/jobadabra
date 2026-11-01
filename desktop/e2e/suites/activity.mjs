/* global document */
// Actions: the three tasks a person presses (Find jobs, Check Gmail, Analyze my job search), each ending in one Recent runs row, plain words, a clean log and nothing left Running.
// Why (1 Nov 2026, owner: "I'd like the beta to have only the critical e2e/user journeys"): the Recent activity SCREEN checks (filter, result card, pop-up, a run read from Notion,
// layout) moved to desktop/test/screen-activity.test.js; what stays is the part that needs a real run. Starts from a set-up install; resets only its own run rows in Notion.
// What goes WRONG (the AI failing, two things at once, a quit in the middle) is the activityfailures suite, in parallel, on its own Notion page.
import fs from 'node:fs';
import path from 'node:path';
import {liveLogProblems} from '../lib/activity.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {noRowStaysRunning, prepare, problemsWith, runTask} from '../lib/activity-steps.mjs';

// Saved gate replies precede caches and transports, including setup and relaunch reads.
export const offlineAi = true;
export const realAi = false;
export const aiAnswers = 'backbone';
export const store = 'standin';
export const minutes = 15;
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
  // The compact banner (owner, 25 Oct 2026): the task's name, its pill and one line; the full report is the run panel's.
  const shown = await page.evaluate(() => ({card: !!document.querySelector('#actions-result:not([hidden]) .run-banner-head .ui-pill'),
    detailed: !!document.querySelector('#actions-result .run-card, #actions-result .insight-card'),
    text: document.getElementById('command-answer')?.hidden ? '' : (document.getElementById('command-answer')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160)}));
  await snap(ctx, `actions-result-${task.command}`, {view: 'actions'});
  return shown;
}

export async function run(ctx) {
  await prepare(ctx);
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
      // On Actions every finished task is the compact banner, never raw text and never its detailed card (that one is the run panel's, checked below).
      if (!result.card) throw new Error(`the Actions page shows the finished ${task.what} as text, not as its compact banner: "${result.text || 'nothing at all'}"`);
      if (result.detailed) throw new Error(`the Actions page draws the detailed card of ${task.what}; it belongs in the drawer and Actions → Runs`);
    }, {needs: ctx.needs});
  }

  await ctx.run('the Actions page and Recent runs render without layout problems after every task', async () => {
    await snap(ctx, 'activity-after-tasks', {view: 'actions'});
    finish(ctx);
  }, {needs: ctx.needs});
}

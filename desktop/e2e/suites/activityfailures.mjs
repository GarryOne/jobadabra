/* global window */
// Actions + Recent activity when things go WRONG, the part that needs the real window: the AI refusing the key (401), a save Notion refuses
// (failuresnotion) and quitting the app in the middle of a run. Starts from a set-up install; resets only its own run rows in Notion. Why (R2, 1 Nov 2026, owner: "only the critical e2e/user journeys"):
// the AI failing as 429/500/spending-limit/silence, Notion failing under a run and the Telegram digest moved to desktop/integration/store/run-*.test.mjs, which run on every PR touching them.
// Job: run the backbone
import {hangCapsFor} from '../lib/hang-caps.mjs';
import {pollUntil, waitForLogLine} from '../lib/wait-on-state.mjs';
import {badSummary, leaks} from '../lib/activity.mjs';
import {LABEL, idsNow, noRowStaysRunning, openRun, own, prepare, quiet, resumedSearchSeen, runTask, runsData, setFeed} from '../lib/activity-steps.mjs';

// Only this arming can prove consumption; global failures may belong to earlier delayed calls.
function consumedFault(fault) {
  if (!fault.failed) throw new Error(`this run never consumed its own ${fault.mode} fault`);
}

// Restore the next scenario's controls, then require this arming's own connections to close.
async function releaseFault(proxy, fault) {
  proxy.setMode('pass');
  const {value} = await pollUntil(() => fault.pending, pending => pending === 0, {log: () => {}});
  if (value !== 0) throw new Error(`AI ${fault.mode} left ${value} request(s) pending after its run ended`);
}

// Where the list's and the panel's pills got their words when they disagree (betas 13, 19, 20, 25 Oct 2026): the record's flags and what each log holds.
const warnLine = line => /^Warning|\b429\b|Too Many Requests|\b(?:skipped|failed)\b|^AI limit reached/i.test(String(line));
const disagreement = (mine, opened, run) => {
  const panelLines = String(opened.log || '').split('\n');
  return `the list says "${mine?.pill}" and the panel "${opened.status}" (record: ok=${run.ok} warned=${run.warned} problem="${run.problem || ''}", ${(run.log || []).length} log line(s), ${(run.log || []).filter(warnLine).length} warning-like; panel log: ${panelLines.length} line(s), ${panelLines.filter(warnLine).length} warning-like; panel box "${opened.warningsTitle}"; app: ${JSON.stringify(opened.state?.activity ?? null).slice(0, 300)})`;
};

// Why (29 Oct 2026, ap): explicit faults, stored metro items and declared background refusals cover every AI ask, so no live key is needed.
export const offlineAi = true;
export const realAi = false;
export const aiAnswers = 'backbone';   // answers its AI from the stored table in every workflow (plan-run.mjs puts it in the matrix)
export const minutes = 40;   // + Notion failures (5 Oct 2026)
// Measured caps and preserved inner-sequence allowances live in the shared table.
export const aggregateBudget = false;
export const hangCaps = hangCapsFor('activityfailures');

export const name = 'activityfailures';
// Why (30 Oct 2026, owner-approved rules A/G2): fixture-only repairs missed this journey in the PR picker; its semantic inputs must run it whole.
export const watches = ['desktop/e2e/fixtures/golden/activityfailures-decide.json',
  'desktop/e2e/fixtures/golden/activityfailures-feed-asks.json', 'desktop/e2e/fixtures/golden/ai-answers.json'];
// Why (30 Oct 2026, ap): shared Notion fault steps need the stand-in; stored AI answers are store-independent, so pin that store for one replay path.
export const store = 'standin';
// One failed step never hides the rest: the runner records it and goes on (lib/runner.mjs); only the setup steps marked `critical` stop the suite.
export const keepGoing = true;
// Notion fails on purpose too (lib/notion-proxy.mjs): busy, an HTML error page, the connection gone.
export const notionProxy = true;
// The app reads Notion's run history every 15 s and picks up the jobs of the last session 20 s after launch: both shortened for the journey (never for a user).
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};   // this suite breaks things on purpose: its Sentry reports are tagged expected
// The AI part (the Notion part left e2e with the suite failuresnotion, 1 Nov 2026).
export async function runParts(ctx, parts) {
  const {proxy} = ctx;
  ctx.activityStateWaits = parts.includes('ai');
  const page = await prepare(ctx);
  // The steps that need the AI proxy in front of the app (a refusal, a delay, silence) run on the API engine with a dummy key when the Mac uses Claude Code (lib/engine.mjs).
  const api = fn => () => ctx.withApi(fn);
  if (parts.includes('ai')) {
    // ---------- (2) the AI fails ----------
    // A search with one new posting: the AI is asked, and the proxy answers the way the real API does when it is in trouble.
    // Why (R2, 1 Nov 2026): 429, 500 and the spending limit moved to desktop/integration/store/run-faults-ai.test.mjs (every PR); the 401 stays here as the journey's proof that a bad key reaches a person in words.
    const FAILURES = [{mode: 'invalid-key', what: 'the AI says the key is invalid (401)'}];
    for (const failure of FAILURES) {
      await ctx.run(`${failure.what}: the run ends as Failed or with warnings, in words, with nothing left Running`, api(async () => {
        setFeed(ctx, [`Senior Site Reliability Engineer, ${failure.mode}`]);
        const fault = proxy.setMode(failure.mode);
        const callsBefore = proxy.stats.calls;
        try {
          const {fresh, shown, seconds} = await runTask(ctx, 'run', {maxMs: 300000, kind: 'search'});
          const mine = shown.find(row => row.id === String(fresh[0].id));
          const run = fresh[0];
          const opened = await openRun(ctx, LABEL.search, {id: fresh[0].id,});
          console.log(`  ${failure.mode}: ${seconds}s, ${proxy.stats.calls - callsBefore} AI call(s); ok=${run.ok} warned=${run.warned}; list: "${mine?.result}" [${mine?.pill}]; panel: [${opened.status}] ${opened.warningsTitle} | ${opened.warnings.slice(0, 160)}`);
          const problems = [];
          if (fresh.length !== 1) problems.push(`${fresh.length} Recent runs rows for one click`);
          if (proxy.stats.calls - callsBefore < 1) problems.push('the AI was never asked, so nothing was tested');
          consumedFault(fault);
          const bad = badSummary(mine?.result);
          if (bad) problems.push(`the list's words are wrong: ${bad}`);
          if (/Completed$/.test(opened.status) && !opened.warnings && !opened.warningList) problems.push('the run says plain "Completed" with no warning, though the AI refused every call');
          if (/warning/i.test(opened.status) !== /warning/i.test(mine?.pill || '')) problems.push(disagreement(mine, opened, run));
          if (/no line about them/i.test(`${opened.warnings} ${opened.warningList}`)) problems.push('the panel warns but gives no reason ("the run recorded warnings, with no line about them")');
          if (!/Failed|warning|Needs/i.test(`${opened.status} ${mine?.pill}`)) problems.push(`neither the panel ("${opened.status}") nor the list ("${mine?.pill}") says it did not fully work`);
          const shownWords = `${opened.warnings} ${opened.warningList} ${opened.result} ${opened.message} ${mine?.result}`;
          if (/rate_limit_error|api_error|authentication_error|invalid_request_error|\{'type': 'error'|Traceback/.test(shownWords)) problems.push(`raw API words are shown: "${shownWords.slice(0, 120)}"`);
          for (const leak of leaks(`${opened.log}\n${shownWords}`, {secrets: [ctx.appKey, ctx.token], dirs: [ctx.profile, ctx.feeds]})) problems.push(`the log shows ${leak}`);
          if (problems.length) throw new Error(problems.join('; '));
          await noRowStaysRunning(ctx);
        } finally { await releaseFault(proxy, fault); }
      }), {needs: ctx.needs, faults: true, stopOnHang: true});
    }
  }
  // Why (1 Nov 2026, owner: "All Notion-only steps"): the Notion part (a save Notion refuses is never shown as saved; suite failuresnotion) is desktop/integration/store/save-refused-notion.test.mjs.
  // Why (1 Nov 2026, owner: "Only tier 1 … should stay e2e"): the Gmail check (night journey J16, Tier 2; suite failureschannels) is an integration test: integration/store/run-channels.test.mjs.
  if (parts.includes('ai')) {
    // ---------- (3) two things at once, and a quit in the middle ----------
    // Removed 6 Oct 2026 (7-minute suite budget): a double-clicked Run (every task step already fails on a run listed twice: runTask), a Gmail check queued behind a
    // search (lib/resume-queue tests), and a Jobs check after the failures (the jobs suite runs a normal one).
    await ctx.run('quitting the app in the middle of a run: it is not shown Running for ever, and the app says what became of it', api(async () => {
      setFeed(ctx, ['Senior Platform Engineer, restart']);
      proxy.setDelay(10000);
      const delayed = proxy.setMode('pass');
      try {
        const before = await idsNow(page);
        await page.click('.nav[data-view="actions"]');
        await page.click('[data-command="run"]');
        await page.waitForFunction(() => window.pilot.runs().then(data => data.running?.kind === 'search'), null, {timeout: 60000, polling: 1000});
        const {value: held} = await pollUntil(() => delayed.delayed, pending => pending > 0, {capMs: 60000});
        if (!held) throw new Error('the interrupted search never reached the delayed AI request');
        await ctx.relaunch();   // the app is killed as a crash or a power cut would: nothing gets to tidy up
        await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
        // The app asks whether to start again what you had started (a native dialog; the journey answers "Start again": lib/resume-queue.js askResume),
        // 3 s after launch here (20 s for a user). Wait for that run to start, then until it is idle again.
        await waitForLogLine(ctx.profile, /started again after a quit/);
        await page.waitForFunction(resumedSearchSeen, [...before], {timeout: 60000, polling: 1000});
        await quiet(ctx, {forMs: 0, maxMs: hangCaps['quitting the app in the middle of a run: it is not shown Running for ever, and the app says what became of it'] * 1000});
        const data = await runsData(page);
        const rows = own(data.runs.filter(run => run.kind === 'search' && run.trigger !== 'schedule' && !before.has(run.id))).mine;
        console.log(`  after the quit: running=${JSON.stringify(data.running)}; search rows: ${rows.map(run => `${run.ok ? 'ok' : 'failed'} ${run.startedAt.slice(11, 19)}`).join(', ')}`);
        if (data.running) throw new Error(`the app still says "${data.running.kind}" is running after everything ended (${data.running.step})`);
        if (!rows.length) throw new Error('the interrupted search left no row in Recent runs at all');
        if (!rows.some(run => run.ok)) throw new Error('the search you had started was not picked up again after the restart');
        await noRowStaysRunning(ctx, {waitMs: 90000});
      } finally { proxy.setDelay(0); }
    }), {needs: ctx.needs, stopOnHang: true});
  }
}
export const run = ctx => runParts(ctx, ['ai']);

/* global window */
// Actions + Recent activity when things go WRONG: the AI answering 429, 500, 401, no credit and never answering; the same task asked twice; a Gmail check queued behind a search;
// quitting the app in the middle of a run. Starts from a set-up install; resets only its own run rows in Notion. The task cards and the Recent activity screen are the
// activity suite, in parallel, on its own Notion page (this split halves the wall-clock time).
// Job: run the backbone
import {hangCapsFor} from '../lib/hang-caps.mjs';
import path from 'node:path';
import {pollUntil, waitForLogLine} from '../lib/wait-on-state.mjs';
import {badSummary, leaks} from '../lib/activity.mjs';
import {digestProblems} from '../lib/telegram-fake.mjs';
import {rows as notionRows} from '../lib/notion.mjs';
import {waitForRunLock, waitedForLock} from '../lib/run-lock.mjs';
import {finish} from '../lib/layout.mjs';
import {LABEL, idsNow, noRowStaysRunning, openRun, own, prepare, quiet, resumedSearchSeen, runTask, runsData, setFeed, sleep, withSilenceLimit} from '../lib/activity-steps.mjs';

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
export const minutes = 40;   // + Notion, Telegram and Gmail failures (5 Oct 2026)
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
// Telegram through a fake Bot API (lib/telegram-fake.mjs): the digest a person receives is read, and Telegram can refuse it.
export const telegram = true;
// Gmail through a fake Google (lib/google-fake.mjs): three invented emails, and a revoked sign-in.
export const google = true;
// The app reads Notion's run history every 15 s and picks up the jobs of the last session 20 s after launch: both shortened for the journey (never for a user).
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};   // this suite breaks things on purpose: its Sentry reports are tagged expected
// The three parts are the suites activityfailures (the AI), failuresnotion and failureschannels (Telegram, Gmail, Google): each on its own Notion page, in parallel.
export async function runParts(ctx, parts) {
  const {proxy} = ctx;
  ctx.activityStateWaits = parts.includes('ai');
  const page = await prepare(ctx);
  // The steps that need the AI proxy in front of the app (a refusal, a delay, silence) run on the API engine with a dummy key when the Mac uses Claude Code (lib/engine.mjs).
  const api = fn => () => ctx.withApi(fn);
  if (parts.includes('ai')) {
    // ---------- (2) the AI fails ----------
    // A search with one new posting: the AI is asked, and the proxy answers the way the real API does when it is in trouble.
    const FAILURES = [
      {mode: 'rate-limit', what: 'the AI answers 429 (rate limit)'},
      {mode: 'server-error', what: 'the AI answers 500'},
      {mode: 'invalid-key', what: 'the AI says the key is invalid (401)'},
      {mode: 'no-credit', what: 'the AI says the credit balance is empty (the spending limit)', limit: true},
    ];
    for (const failure of FAILURES) {
      await ctx.run(`${failure.what}: the run ends as Failed or with warnings, in words, with nothing left Running`, api(async () => {
        setFeed(ctx, [`Senior Site Reliability Engineer, ${failure.mode}`]);
        const fault = proxy.setMode(failure.mode);
        const callsBefore = proxy.stats.calls;
        try {
          const {fresh, shown, seconds} = await runTask(ctx, 'run', {maxMs: 300000, kind: 'search'});
          const mine = shown.find(row => row.id === String(fresh[0].id));
          const run = fresh[0];
          const opened = await openRun(ctx, LABEL.search, {id: fresh[0].id, ...(failure.mode === 'rate-limit' ? {snapAs: 'activity-run-warned', situation: 'A Jobs check that finished with warnings because the AI answered 429 (rate limit): its detail pane in the Recent activity panel'} : {})});
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
          if (failure.limit && !/spending limit|AI limit/i.test(shownWords)) problems.push(`the spending limit is not named as such: "${shownWords.slice(0, 160)}"`);
          for (const leak of leaks(`${opened.log}\n${shownWords}`, {secrets: [ctx.appKey, ctx.token], dirs: [ctx.profile, ctx.feeds]})) problems.push(`the log shows ${leak}`);
          if (problems.length) throw new Error(problems.join('; '));
          await noRowStaysRunning(ctx);
        } finally { await releaseFault(proxy, fault); }
      }), {needs: ctx.needs, faults: true, stopOnHang: true});
    }
  }
  if (parts.includes('notion')) {
    // ---------- (2b) Notion fails (5 Oct 2026) ----------
    // The run's own writes fail the way Notion and networks really do; reads still work, so the panel can show what became of the run. A person must see a clear end,
    // in words: never "Running" for ever, never the HTML of an error page or Notion's JSON.
    const NOTION_FAULTS = [
      // writes: the 3 refusals hit the run's own writes (its row, its report), never reads that leave no trace: what ran before no longer decides whether a warning is logged (beta 2, 25 Oct 2026).
      {mode: 'rate-limit', times: 3, writes: true, what: 'Notion is busy (429) for a moment', recovers: true},
      {mode: 'html', writes: true, what: 'Notion answers an HTML error page instead of JSON'},
      {mode: 'offline', writes: true, what: 'the connection to Notion is gone'},
    ];
    for (const fault of NOTION_FAULTS) {
      await ctx.run(`${fault.what} during a Jobs check: the run ends ${fault.recovers ? 'normally' : 'as Failed or with warnings'}, in words, with nothing left Running`, async () => {
        setFeed(ctx, [`Senior Site Reliability Engineer, notion ${fault.mode}`]);
        const failedBefore = ctx.notion.stats.failed;
        ctx.notion.fail(fault.mode, {times: fault.times ?? null, writes: !!fault.writes});
        let finished;
        try { finished = await runTask(ctx, 'run', {maxMs: 300000, kind: 'search'}); } finally { ctx.notion.pass(); }
        const {fresh, shown} = finished;
        const mine = shown.find(row => row.id === String(fresh[0].id));
        const opened = await openRun(ctx, LABEL.search, {id: fresh[0].id, ...(fault.mode === 'html' ? {snapAs: 'activity-notion-html', situation: 'A Jobs check during which Notion answered an HTML error page to every write: its detail pane in the Recent activity panel'} : {})});
        console.log(`  notion ${fault.mode}: ${ctx.notion.stats.failed - failedBefore} call(s) failed; ok=${fresh[0].ok}; list: "${mine?.result}" [${mine?.pill}]; panel: [${opened.status}] ${opened.warnings.slice(0, 160)}`);
        const problems = [];
        if (ctx.notion.stats.failed - failedBefore < 1) problems.push('Notion was never asked while failing, so nothing was tested');
        const words = `${opened.warnings} ${opened.warningList} ${opened.result} ${opened.message} ${mine?.result}`;
        if (/<!DOCTYPE|<html|Bad Gateway<|"object":\s*"error"|rate_limited|internal_server_error|ECONNRE|socket hang up/i.test(words)) problems.push('raw technical text from the failed Notion call is shown to the person');
        const bad = badSummary(mine?.result);
        if (bad) problems.push(`the list's words are wrong: ${bad}`);
        if (!fault.recovers && /Completed$/.test(opened.status) && !opened.warnings && !opened.warningList) problems.push('the run says plain "Completed" though its results never reached Notion');
        if (/warning/i.test(opened.status) !== /warning/i.test(mine?.pill || '')) problems.push(disagreement(mine, opened, fresh[0]));
        if (problems.length) throw new Error(problems.join('; '));
        await noRowStaysRunning(ctx);
      }, {needs: ctx.needs, faults: true});
    }
    // A save Notion refuses must never look saved: the engine writes Notion first and changes nothing when it fails (src/desktop.py), so the person is told,
    // the row in Notion is as it was, and the list does not claim the job is saved. A silent loss here is a job the person thinks they kept (5 Oct 2026).
    await ctx.run('a Save that Notion refuses is never shown as saved: the person is told in words, and Notion and the list still agree', async () => {
      // Its own job first (9 Oct 2026: run as failuresnotion, nothing had opened the Jobs page, so the list was never loaded and the step never
      // reached Save; and under the applicant's own strategy, Zurich only, a "Zurich or Amsterdam" posting was placed outside their places and
      // dropped): one clean search for a posting in Zurich, then the Jobs page, whose list must hold THAT job before Notion is made to refuse.
      const [seed] = setFeed(ctx, ['Senior Site Reliability Engineer, save seed'], {location: 'Zurich, Switzerland'});
      await runTask(ctx, 'run', {maxMs: 300000, kind: 'search'});
      await page.click('.nav[data-view="jobs"]');
      const unsaved = () => page.evaluate(url => (window.__jp.shared.allJobs || []).find(item => item.url === url && item.status !== 'saved'), seed.absolute_url);
      let job = await unsaved();
      for (let waited = 0; !job && waited < 60000; waited += 2000) { await sleep(page, 2000); job = await unsaved(); }
      if (!job) throw new Error(`the seed did not take: a clean search for "${seed.title}" (Zurich) ran, yet the Jobs list does not hold it (${seed.absolute_url})`);
      console.log(`  save seed: "${job.title}" (${job.company}) is in the list, status ${job.status}`);
      const statusIn = async () => (await notionRows(ctx.token, 'Job Matches — AI Scored')).find(row => String(row.properties?.['Job URL']?.url || '').replace(/\/$/, '') === job.url.replace(/\/$/, ''))?.properties?.Status?.select?.name || '';
      const before = await statusIn();
      ctx.notion.fail('server-error', {writes: true});
      let result;
      try { result = await page.evaluate(url => window.pilot.setStatus(url, 'saved').catch(error => ({ok: false, error: error.message})), job.url); } finally { ctx.notion.pass(); }
      const after = await statusIn();
      const listed = await page.evaluate(url => (window.__jp.shared.allJobs || []).find(item => item.url === url)?.status, job.url);
      console.log(`  save refused: answer ${JSON.stringify(result).slice(0, 160)}; Notion "${before}" -> "${after}"; list "${listed}"`);
      const problems = [];
      if (result?.ok && after === before) problems.push('the app answered "saved" but Notion never got it: a silent loss');
      if (!result?.ok && after !== before) problems.push(`the app said it failed but Notion changed ("${before}" -> "${after}")`);
      if (!result?.ok && listed === 'saved') problems.push('the list shows the job as saved though the save failed');
      if (!result?.ok && /<!DOCTYPE|internal_server_error|"object":|Traceback/.test(String(result?.error || ''))) problems.push('the message for the person carries Notion\'s raw answer');
      if (problems.length) throw new Error(problems.join('; '));
    }, {needs: ctx.needs, faults: true});
  }
  if (parts.includes('channels')) {
    // ---------- (2c) Telegram (5 Oct 2026) ----------
    // The digest a person receives, read from the fake Bot API: one message to their chat, readable, every promised job listed. Then Telegram refuses it.
    const CHAT = '424242';
    // Connect or disconnect Telegram, and say what the app kept (#302, 5 Oct 2026: the second connect of a run did not take, the engine said "Telegram isn't connected", and the step failed
    // without saying why): a connect that the app did not keep fails here, with the words, before the scenario starts.
    const connectTelegram = async on => {
      const kept = await page.evaluate(async ([chat, on]) => {
        if (on) await window.pilot.saveSecret('TELEGRAM_BOT_TOKEN', '123456:e2e-fake-token');
        await window.pilot.saveSettings({telegramChatId: on ? chat : ''});
        const state = await window.pilot.state();
        return {chat: state?.settings?.telegramChatId || '', secret: !!state?.secrets?.TELEGRAM_BOT_TOKEN || !!state?.telegramToken};
      }, [CHAT, on]);
      console.log(`  telegram ${on ? 'connected' : 'disconnected'}: the app keeps chat "${kept.chat}"`);
      if (on && kept.chat !== String(CHAT)) throw new Error(`the app did not keep the Telegram chat after connecting (it holds "${kept.chat}"): the scenario cannot start`);
    };
    await ctx.run('with Telegram connected, a Jobs check sends one readable digest to the person\'s chat', async () => {
      await connectTelegram(true);
      try {
        setFeed(ctx, ['Senior Site Reliability Engineer, telegram digest']);
        const before = ctx.telegram.sent.length;
        const {fresh} = await runTask(ctx, 'run', {maxMs: 300000, kind: 'search'});
        const mine = ctx.telegram.sent.slice(before).filter(item => item.chat === CHAT);
        console.log(`  telegram: ${mine.length} message(s); first: ${(mine[0]?.text || '').replace(/\n/g, ' ').slice(0, 140)}`);
        const problems = [];
        if (!fresh[0].ok) problems.push('the run did not end ok');
        if (!mine.length) problems.push('no message reached the person\'s chat');
        const digests = mine.filter(item => /^✈️/.test(item.text.replace(/<[^>]+>/g, '').trim()));
        if (digests.length > 1) problems.push(`${digests.length} digests for one check`);
        for (const item of digests) for (const problem of digestProblems(item.text)) problems.push(`the digest: ${problem}`);
        for (const leak of leaks(mine.map(item => item.text).join('\n'), {secrets: [ctx.appKey, ctx.token], dirs: [ctx.profile, ctx.feeds]})) problems.push(`the message shows ${leak}`);
        if (problems.length) throw new Error(problems.join('; '));
      } finally { await connectTelegram(false).catch(() => {}); }
    }, {needs: ctx.needs, faults: true});
    // ---------- (2d) Gmail (5 Oct 2026) ----------
    await ctx.run('the Gmail check reads the inbox through Google and ends in words, with nothing left Running', async () => {
      const before = ctx.google.stats.read;
      const {fresh, shown} = await runTask(ctx, 'mail', {maxMs: 240000, kind: 'mail'});
      const mine = shown.find(row => row.id === String(fresh[0].id));
      console.log(`  gmail: ${ctx.google.stats.read - before} email(s) read of ${ctx.google.count}; ok=${fresh[0].ok}; list: "${mine?.result}" [${mine?.pill}]`);
      const problems = [];
      if (ctx.google.stats.read - before < 1) problems.push('no email was read, so nothing was tested');
      if (!fresh[0].ok) problems.push(`the check did not end ok ("${mine?.result}")`);
      const bad = badSummary(mine?.result);
      if (bad) problems.push(`the list's words are wrong: ${bad}`);
      if (problems.length) throw new Error(problems.join('; '));
      await noRowStaysRunning(ctx);
    }, {needs: ctx.needs, faults: true});
  }
  if (parts.includes('ai')) {
    await ctx.run('the AI never answers: the run is stopped after its silence limit and ends as Stopped, in words, with nothing left Running', api(() => withSilenceLimit(ctx, async () => {
      // The app stops a run that prints nothing for 15 minutes; this test shortens that to 10 s (JOB_PILOTTO_E2E_IDLE_MS, honoured only in the journey).
      // An earlier step's run may still hold the engine's run lock (#1662: 0.8.6/0.8.7 mixed "check your AI key" with "another search is running"): wait it out, so the 10 s are this run's own silence.
      await waitForRunLock(path.join(ctx.profile, 'data'));
      setFeed(ctx, ['Lead Platform Engineer, silence']);
      const fault = proxy.setMode('hang');
        const {fresh, shown, seconds} = await runTask(ctx, 'run', {maxMs: 180000, kind: 'search'});
        const mine = shown.find(row => row.id === String(fresh[0].id));
        const opened = await openRun(ctx, LABEL.search, {id: fresh[0].id, snapAs: 'activity-run-failed', situation: 'A Jobs check stopped by Jobadabra after the AI went silent: Stopped, with its reason, the step it was on and Run again, in the Recent activity panel'});
        console.log(`  silence: ${seconds}s; ok=${fresh[0].ok}; list: "${mine?.result}" [${mine?.pill}]; panel: [${opened.status}] ${opened.warnings.slice(0, 160)}`);
        const problems = [];
        if (fresh.length !== 1) problems.push(`${fresh.length} rows for one click: ${fresh.map(run => `[${run.id} ${run.trigger} ${run.where} ok=${run.ok} start=${run.startedAt} notion=${run.notionUrl.slice(-6)} result="${run.result.slice(0, 50)}" log=${run.log.length}]`).join(' ')}`);
        consumedFault(fault);
        if (fresh[0].ok) problems.push('a run whose AI never answered ended as a success');
        if (waitedForLock(`${fresh[0].log.join('\n')} ${opened.log}`)) problems.push('the stopped run waited for another run\'s lock, so it was not the AI\'s silence that was tested');
        const bad = badSummary(mine?.result);
        if (bad) problems.push(`the list's words are wrong: ${bad}`);
        if (!/no output|stopp|did not answer|silen/i.test(`${fresh[0].log.join('\n')} ${fresh[0].result} ${opened.log} ${opened.warnings}`)) problems.push('nothing in the log or the words says the run was stopped for its silence');
        if (problems.length) throw new Error(problems.join('; '));
        await noRowStaysRunning(ctx);
    })), {needs: ctx.needs, faults: true, stopOnHang: true});

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

    await ctx.run('the failure and queued states render without layout problems', async () => {
      finish(ctx);
    }, {needs: ctx.needs});
  }
}
export const run = ctx => runParts(ctx, ['ai']);

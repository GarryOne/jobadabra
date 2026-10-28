// The app's background jobs at start-up (moved out of main.js, 8 Oct 2026): the one-time move of user data left on this Mac to Notion, the update check, the
// timers (the focus reminder, the run announcements), resuming the queue and the Always-on checks. main.js passes in the services they share.
// Guards: the update, queue and focus-reminder tests in desktop/test.
import * as backup from './backup.js';
import * as critical from './critical.js';
import * as github from './github.js';
import * as migrate from './migrate.js';
import * as notionGate from './notion-gate.js';
import * as pipeline from './pipeline.js';
import * as poolShare from './pool-share.js';
import * as reminders from './interview-reminders.js';
import * as runHistory from './run-history.js';
import * as startupMove from './startup-move.js';
import * as telegramCloud from './telegram-cloud.js';
import * as viewCache from './view-cache.js';
import {backgroundApplyFor} from './background-apply-controller.js';
import {e2eMs} from './e2e-timing.js';
import {log as appLog} from './log.js';
import {resumeDelay, scheduleResume} from './resume-queue.js';
import {startSchedule} from './schedule.js';
import {watchOrphans} from './orphans.js';
import {watchSleep, startHeartbeat} from './awake.js';

import {runState} from './run-state.js';
import {isTwin} from './twin.js';

export function registerBackgroundHandlers(ctx) {
  const {DEMO, announceRuns, app, backupNow, checkForUpdate, cloud, focusReminder, log, notify, powerMonitor, restartTelegram, resumeQueue, skipUntilNotion, storage, syncCv, toWindow} = ctx;
  if (!DEMO) {
    // User data left on this Mac -> Notion (source of truth), once. It runs while the window loads, so the
    // window reads again what moved (e.g. open questions read before they reached Notion looked like none).
    // Why (2026-10-28, red main after #2339): the move runs for seconds behind the first reads and drops this Mac's profile.md and answers.md once Notion has them, so anything
    // that writes or packs those files must know when it is over: the line below is that signal (desktop/e2e/suites/settings.mjs waits for it; guard test/startup-moves-signal.test.js); the crash sweep below waits for the same moves to settle.
    const moves = startupMove.track(critical.during('Moving your data to Notion', () => migrate.run(storage, log)), outcome => appLog('migrate', 'startup moves finished', outcome));
    moves.then(moved => { if (moved.length) toWindow('moved', moved); }, () => {});   // a failed move is already in the log line above
    // Crash rule (2026-10-29, owner): a press the last run's quit cut off is handed to the person once the store is settled; never retried (guard test/crash-rule-wired.test.js).
    moves.catch(() => {}).then(() => backgroundApplyFor(storage).sweepInterrupted()).catch(error => appLog('apply', `interrupted presses not checked: ${error.message}`));
    syncCv();
    // Recent activity from Notion ⏱️ Search runs (every run's row, wherever it ran), every 15 s.
    let notionTimer;
    const readRuns = async () => {
      clearTimeout(notionTimer);
      let busy = false;
      try { runState.notionRuns = await runHistory.list(storage); } catch (error) { busy = error.status === 429; appLog('run', `history not read: ${error.message}`, {status: error.status || 0}); log(`Run history not read from Notion: ${error.message}`); }
      // While a GitHub run is only a placeholder, read Notion again in 5 s so its row replaces "Running"
      // as soon as it exists. Otherwise every 15 s. Notion busy: step back for a minute.
      notionTimer = setTimeout(readRuns, busy ? 60000 : runState.pendingCloud.length ? 5000 : e2eMs('HISTORY_MS', 15000));
    };
    readRuns();
    // A job sent to GitHub: "Starting on GitHub…" until its row appears (it's read again sooner than usual).
    // The dispatch itself returns no run id, so the link is filled in once Actions lists the run, and the
    // placeholder is dropped when that run finishes — a finished check must not stay "Running".
    const claimedGithubRuns = new Set();
    const watchGithubRun = (job, workflow) => {
      const since = job.id - 15000;
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      (async () => {
        let run = null;
        for (let attempt = 0; attempt < 24 && runState.pendingCloud.includes(job) && !run; attempt++) {
          await pause(attempt ? 5000 : 2000);
          if (!runState.pendingCloud.includes(job)) return;
          let runs = [];
          try { runs = await github.dispatchedRuns(storage, {workflow, since}); }
          catch (error) { appLog('dispatch', `github run not listed: ${error.message}`, {workflow}); continue; }
          run = runs.find(item => !claimedGithubRuns.has(item.id)) || null;
        }
        if (!run || !runState.pendingCloud.includes(job)) return;
        claimedGithubRuns.add(run.id);
        const describe = async current => {
          let jobs = [];
          try { jobs = await github.runJobs(storage, current.id); } catch (error) { appLog('dispatch', `github jobs not listed: ${error.message}`, {run: current.id}); }
          const link = github.runLink(current, jobs);
          if (link.url) job.url = link.url;
          if (link.runUrl) job.runUrl = link.runUrl;
          return link;
        };
        const link = await describe(run);
        appLog('dispatch', `github run ${run.id} for ${workflow}`, {status: link.status, job: link.jobId});
        setTimeout(readRuns, 1000);  // the row may already be there: drop "Starting on GitHub…" without a reload
        if (run.status === 'completed') {
          appLog('dispatch', `github run ${run.id} finished`, {conclusion: run.conclusion || ''});
          runState.pendingCloud = runState.pendingCloud.filter(item => item !== job);
          return;
        }
        while (runState.pendingCloud.includes(job)) {
          await pause(5000);
          if (!runState.pendingCloud.includes(job)) return;
          let again;
          try { again = await github.workflowRun(storage, run.id); }
          catch (error) { appLog('dispatch', `github run ${run.id} not read: ${error.message}`); continue; }
          if (!again || again.status !== 'completed') { await describe(again || run); continue; }
          appLog('dispatch', `github run ${run.id} finished`, {conclusion: again.conclusion || ''});
          runState.pendingCloud = runState.pendingCloud.filter(item => item !== job);
          setTimeout(readRuns, 1000);
          return;
        }
      })();
    };
    github.onDispatch(({workflow, inputs}) => {
      const mode = workflow === 'mail.yml' ? 'mail' : workflow === 'scout.yml' ? 'scout' : inputs.mode || 'scheduled';
      const kind = {scheduled: 'search', run: 'search'}[mode] || mode;
      const job = {id: Date.now(), mode, kind, live: true, where: 'github', trigger: 'you', startedAt: new Date().toISOString(), step: 'Starting on GitHub…'};
      runState.pendingCloud.push(job);
      watchGithubRun(job, workflow);
      setTimeout(readRuns, 20000);
    });
    // The repo's workflow files follow this version of the app (e.g. a new input), unchanged files untouched;
    // keys kept outside the app's store (the Google sign-in) go along.
    // Updates: shortly after start, then every 10 minutes while installs are few (back to 6 hours for a mass rollout: GitHub allows 60 anonymous checks an hour per IP; an installed app only; a source checkout updates with git).
    if (app.isPackaged && !DEMO) { setTimeout(() => checkForUpdate(), 20000); setInterval(() => checkForUpdate(), 10 * 60 * 1000); }
    // Interview reminders: a Mac notification 10 and 1 minute before each Next interview (from the last read of the Jobs list).
    const remind = () => {
      if (DEMO || !storage.settings().setupDone || !reminders.on(storage) || !notionGate.tracking(storage)) return;
      const jobs = viewCache.recall(storage, 'jobs')?.result?.jobs || [];
      const sent = storage.settings().reminded || {};
      const items = reminders.due(jobs, sent);
      if (!items.length) return;
      const next = {...sent};
      for (const item of items) {
        const words = reminders.text(item);
        notify(words.title, words.body, () => toWindow('openInterviews'), 'info');
        for (const key of item.keys) next[key] = true;
      }
      storage.saveSettings({reminded: Object.fromEntries(Object.entries(next).slice(-200))});
    };
    setInterval(remind, 30000);
    if (!DEMO) watchOrphans(appLog, {onStopped: async run => {
      const closed = await runHistory.closeLost(storage, Date.now() - run.elapsed * 1000, `Stopped: the app had lost this run (${run.why}).`);
      for (const row of closed) appLog('run', 'closed the row of a run the app stopped', {kind: row.kind, started: row.startedAt, decidedBy: 'orphan watchdog'});
    }});   // an engine run left behind by a restart, stuck: stop it (lib/orphans.js)
    setTimeout(remind, 15000);
    // The engine repo renamed while the app runs (lib/engine-repo.js): the user's workflows get the new name within 6 hours, not at the next start.
    if (!DEMO) setInterval(async () => {
      if (!cloud() || !await github.resolveEngineRepo()) return;
      github.updateRepo(storage).then(changed => appLog('cloud', 'repo follows the engine\'s new name', {engine: github.currentEngineRepo(), what: changed.join(', '), decidedBy: 'engine renamed'}),
        error => appLog('cloud', 'repo not updated', {error: error.message}));
    }, 6 * 3600 * 1000);
    // The user's side kept in step with this app (lib/github.js updateRepo, lib/telegram-cloud.js refresh): names only, never a value.
    if (cloud()) github.updateRepo(storage).then(changed => {
      if (changed.length) { log(`Updated in your GitHub repo: ${changed.join(', ')}`); appLog('cloud', 'repo brought in step with this app', {changed: changed.length, what: changed.join(', '), decidedBy: 'app start'}); }
    }, error => { log(`GitHub repo not updated: ${error.message}`); appLog('cloud', 'repo not updated', {error: error.message}); })
      .then(() => telegramCloud.refresh(storage))
      .then(result => result && appLog('cloud', result.ok ? 'Telegram Worker redeployed: other code or settings' : 'Telegram Worker not redeployed', {error: result.error, decidedBy: 'app start'}),
        error => appLog('cloud', 'Telegram Worker not redeployed', {error: error.message}));
    const backupIfDue = why => { if (storage.settings().setupDone && backup.due(storage.settings())) backupNow(why); };
    backupIfDue('due at start');
    setInterval(() => backupIfDue('weekly tick'), e2eMs('BACKUP_TICK', 6 * 3600 * 1000));
    // Catch-up share to the central pool: what a cut-short or offline run could not send (finds go out one by one as they happen).
    if (!DEMO && storage.settings().setupDone && poolShare.on(storage)) setTimeout(() => pipeline.run(storage, ['src.contribute', '--send'])
      .then(({code}) => appLog('pool', 'catch-up share at start', {code}), error => appLog('pool', 'catch-up share failed', {error: error.message})), 60000);
    restartTelegram();
    startHeartbeat();
    watchSleep(powerMonitor, appLog);   // the run watchdogs leave out the time this Mac sleeps (lib/awake.js)
    // On the chosen schedule while the app is open (the digest goes to Telegram when there's something new).
    // Searches: a notification a minute before one starts; every finished run: announceRuns (every 5 s).
    if (!isTwin()) startSchedule(storage, {   // a twin runs nothing on a schedule (lib/twin.js)
      // Their notifications come from announceRuns, like every run's (wherever it ran).
      search: () => pipeline.refresh(storage, log, 'scheduled', 'schedule'),
      mail: () => (notionGate.tracking(storage) ? pipeline.checkMail(storage, log, 'schedule') : skipUntilNotion('mail')),
      scout: () => pipeline.scout(storage, log, 'schedule'),
    }, powerMonitor, {soon: () => notify('Searching for new jobs in 1 minute', 'Your scheduled search for new jobs is about to run.', {activity: true}, 'info')});
    setInterval(announceRuns, 5000);
    scheduleResume(pipeline, storage, {cloud: !!storage.settings().cloud?.repo, begin: resumeQueue, delayMs: resumeDelay()});  // after the schedule's own catch-up check has queued what's due; the queue is read now, not then
  }
  if (!DEMO) setInterval(() => focusReminder().catch(() => {}), 5 * 60 * 1000);
}

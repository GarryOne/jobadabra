// The app's notifications and Recent activity (moved out of main.js, 8 Oct 2026): a notification (macOS, or a toast in the window when macOS won't show it), the run list
// merged from Notion and this Mac, announcing finished runs, and the nudge after two weak job checks. The window and storage are passed as getters.
// Guards: the notify-watch, run-history, few-jobs and activity tests in desktop/test.
import * as critical from './critical.js';
import * as fewJobs from './few-jobs.js';
import * as github from './github.js';
import * as notifyChannel from './notify-channel.js';
import * as notifyWatch from './notify-watch.js';
import * as pipeline from './pipeline.js';
import * as runHistory from './run-history.js';
import {notCheckedNotice} from './not-checked-notice.js';
import * as telegram from './telegram.js';
import {cloudNextAt, nextAt, nextMailAt} from './schedule.js';
import {log as appLog} from './log.js';
import {runState} from './run-state.js';

export function createAppNotify(ctx) {
  const {DEMO, Notification, app, getStorage, targets, toWindow, getWindow} = ctx;
  // A macOS notification; clicking it brings the app to the front and, with a target (renderer/targets.js: a page, a section, a run's result, a job's row),
  // opens it. The target may also be a function (the older callers). The same message as a window toast carries the target too.
  // If macOS blocks notifications (common for an app run with npm start: "Electron" is off in System
  // Settings), the same message shows as a toast inside the window, with a one-time hint how to allow them.
  let notificationsBlocked = false, hintedMissing = false;
  function openTarget(target) {
    const clean = targets.clean(target);
    if (clean) toWindow('openTarget', clean);
  }
  function notify(title, body, target = null) {
    if (process.env.JOB_PILOTTO_SMOKE) return;
    const onClick = typeof target === 'function' ? target : () => openTarget(target);
    const toast = hint => toWindow('toast', {title, body, hint, target: typeof target === 'function' ? null : targets.clean(target)});
    if (!Notification.isSupported() || notificationsBlocked) { appLog('notify', 'window toast only', {title, blocked: notificationsBlocked}); toast(false); return; }
    const note = new Notification({title, body, silent: false});
    note.on('click', () => { getWindow()?.show(); getWindow()?.focus(); onClick(); });
    // Titles only in the log, never the body (it can name an employer or an interview).
    notifyWatch.watch(note, {
      onShown: () => appLog('notify', 'shown by macOS', {title}),
      onFailed: () => { const first = !notificationsBlocked; notificationsBlocked = true; appLog('notify', 'macOS refused it: window toast instead', {title}); toast(first); },
      onMissing: () => {
        appLog('notify', 'macOS never showed it (notifications not allowed for this app?): window toast and Dock bounce instead', {title, dev: !app.isPackaged});
        toast(!hintedMissing); hintedMissing = true;
        if (!getWindow()?.isFocused()) app.dock?.bounce('informational');
      }});
    note.show();
  }

  // Recent activity: Notion's run history merged with this Mac's own runs and the jobs just sent to GitHub.
  // A run going on in GitHub can be stopped too, once Actions has listed it (its address carries the run id): Stop cancels it there.
  function cloudStop(run) {
    const githubRun = github.runIdOf(run?.runUrl || run?.url);
    return githubRun && getStorage().settings().cloud?.repo ? {...run, stoppable: true, githubRun} : run;
  }
  function activity() {
    runState.pendingCloud = runState.pendingCloud.filter(job => Date.now() - job.id < 10 * 60000);
    const local = pipeline.runs(getStorage());
    const {runs, live, waiting} = runState.notionRuns ? runHistory.merge(runState.notionRuns, local, runState.pendingCloud) : {runs: local, live: runState.pendingCloud[0] || null, waiting: runState.pendingCloud};
    runState.pendingCloud = waiting;
    const settings = getStorage().settings();
    const cloud = cloudNextAt(settings);  // Always on: GitHub's schedule (the Mac's own is off then)
    return {runs, running: pipeline.running() || cloudStop(live), queued: pipeline.queued(), lastSearchAt: settings.lastSearchAt || null,
      nextSearchAt: nextAt(settings) ?? cloud.search, nextMailAt: nextMailAt(settings) ?? cloud.mail, nextScoutAt: cloud.scout,
      cloud: !!settings.cloud?.repo, historyLoaded: !!runState.notionRuns,  // false until the run history was read from Notion
      busy: critical.labels()};  // the app's own work under way (the start-up move into Notion…): its engine steps take the run lock too
  }

  // While the app is open, every finished job is a notification, wherever it ran (this Mac, GitHub, a Telegram
  // button): once per run. With the window in front the app shows it itself (its own pop-up), so no double.
  const announced = new Set();
  let announcing = false;
  function announceRuns() {
    const {runs} = activity();
    if (!announcing) { runs.forEach(run => announced.add(run.id)); announcing = true; return; }  // history, not news
    for (const run of runs) {
      if (announced.has(run.id)) continue;
      announced.add(run.id);
      if (Date.now() - Date.parse(run.endedAt || run.startedAt) > 5 * 60000) continue;
      if (getWindow()?.isFocused()) continue;
      if (run.kind === 'prepare' && run.where === 'mac') continue;  // prepareKit gives its own ("Press Apply…")
      const note = notCheckedNotice(run) || runHistory.notice(run);
      if (note) notify(note.title, note.body, note.target);   // a click opens that run's result
    }
    nudgeFewJobs(runs);
  }

  // Two jobs checks in a row with few new jobs (lib/few-jobs.js): once per streak, open that run's "Few new jobs" box; a dot on Strategy;
  // one Telegram line at most weekly (Always on users are rarely in the app).
  function nudgeFewJobs(runs) {
    if (DEMO) return;   // demo runs are fictional, and a prompt would land in the middle of the demo window's tests
    const found = fewJobs.streak(runs);
    const what = fewJobs.due(found, getStorage().settings());
    if (!what.notify) return;
    getStorage().saveSettings({fewJobsNudgedFor: found.runId, ...(what.telegram ? {fewJobsTelegramAt: Date.now()} : {})});
    const said = fewJobs.words(found);
    appLog('advice', 'few new jobs nudge', {run: found.runId, counts: found.counts.join(','), telegram: what.telegram, decidedBy: 'two weak checks in a row'});
    if (getWindow()?.isFocused()) toWindow('toast', {title: said.title, body: said.body, target: {run: found.runId}});
    else notify(said.title, said.body, {run: found.runId});
    toWindow('few-jobs', {runId: found.runId});
    const token = getStorage().secret('TELEGRAM_BOT_TOKEN'), chat = getStorage().settings().telegramChatId;
    if (what.telegram && !DEMO) notifyChannel.sendEmail(getStorage(), {subject: said.title, text: said.telegram}).catch(() => {});   // the e-mail form, when e-mail is chosen
    if (what.telegram && token && chat && !DEMO && notifyChannel.channelsOf(getStorage()).includes('telegram')) {
      telegram.api(token, 'sendMessage', {chat_id: chat, text: said.telegram})
        .catch(error => appLog('advice', 'few new jobs Telegram line not sent', {error: error.message}));
    }
  }
  return {notify, activity, announceRuns};
}

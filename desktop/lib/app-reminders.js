// The app's reminders and what needs the user (moved out of main.js, 8 Oct 2026): the Focus reminders at 11:00, 15:00 and 19:00, resuming the queue after a start,
// waiting on Notion before a loop runs, and the notification when a session needs an answer. main.js passes in the services they share (the window, storage
// and telemetry as getters). Guards: the focus-reminder, queue-resume and session-notice tests in desktop/test.
import * as notionGate from './notion-gate.js';
import * as pipeline from './pipeline.js';
import * as runHistory from './run-history.js';
import * as terminals from './terminals.js';
import {askResume} from './resume-queue.js';
import {log as appLog} from './log.js';
import {shouldNotify} from './needs-you.js';

export function createAppReminders(ctx) {
  const {FOCUS_HOURS, Notification, dialog, log, notify, skippedLoops, getStorage, targets, toWindow, getWindow} = ctx;
  function skipUntilNotion(loop) {
    if (!skippedLoops.has(loop)) { skippedLoops.add(loop); appLog('notion', 'loop skipped: not connected', {loop}); }
    return Promise.resolve();
  }
  async function focusReminder(now = new Date()) {
    const settings = getStorage().settings();
    if (!settings.setupDone || settings.focusReminders === false) return;
    if (!notionGate.tracking(getStorage())) return skipUntilNotion('focus reminder');
    const slot = FOCUS_HOURS.filter(hour => now.getHours() >= hour).pop();
    if (slot == null) return;
    const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${slot}`;  // local day
    if (settings.lastFocusReminder === key) return;
    getStorage().saveSettings({lastFocusReminder: key});
    const text = await pipeline.focusReminder(getStorage(), true);
    appLog('focus', `reminder ${key}: ${text ? 'sent' : 'nothing worth saying'}`, {chars: text.length});
    if (text) notify('Focus: what to do next', text, {view: 'focus'}, 'info');
  }


  // Jobs you started that were running or waiting when the app quit (pipeline queue.json): the app asks whether to start them again (owner,
  // 7 Oct 2026). The schedule's own (searches, Gmail checks) aren't asked about: its catch-up runs whatever is due anyway.
  async function resumeQueue(jobs) {
    if (!jobs.length) return;
    const names = [...new Set(jobs.map(job => pipeline.taskName(job.kind)))];
    const parent = getWindow() && !getWindow().isDestroyed() ? getWindow() : null;
    const {start, decidedBy} = await askResume(names, {ask: options => (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))})
      .catch(error => { appLog('run', 'resume question failed', {error: error.message}); return {start: false, decidedBy: 'question failed'}; });
    appLog('run', start ? 'started again after a quit' : 'left stopped after a quit', {kinds: jobs.map(job => job.kind).join(','), decidedBy});
    // The Notion row of a run the quit killed: the engine closes it itself now (src/notion/cron_runs.py); this is for one that could not (Windows ends the whole tree).
    try {
      const closed = await runHistory.closeInterrupted(getStorage(), jobs, {reason: start ? 'Interrupted: the app was closed before this run finished; it was started again.'
        : 'Interrupted: the app was closed before this run finished; left stopped.'});
      for (const row of closed) appLog('run', 'closed the row of a run the quit interrupted', {kind: row.kind, started: row.startedAt, decidedBy});
    } catch (error) { appLog('run', 'interrupted rows not closed', {error: error.message}); }
    if (!start) return;
    for (const job of jobs) {
      const failed = error => log(`${pipeline.taskName(job.kind)} failed: ${error.message}`);
      if (job.kind === 'search') pipeline.refresh(getStorage(), log, job.resume.mode || 'run', 'you').catch(failed);
      else if (job.kind === 'mail') pipeline.checkMail(getStorage(), log, 'you').catch(failed);
      else if (pipeline.TASKS[job.kind] && Array.isArray(job.resume.args)) pipeline.task(getStorage(), job.kind, job.resume.args, log, 'you').catch(failed);
    }
  }

  // A Claude session waits for you: a notification (a click opens that session in the app) and a toast in the window.
  const needsYouSeen = new Map();  // session id -> the last question announced (lib/needs-you.js)
  function sessionNeedsYou(session) {
    const what = terminals.label(session);
    const text = session.brief || 'Claude needs your input';  // one plain sentence; the whole message is on the session page
    if (!shouldNotify(needsYouSeen, session.id, text)) return;  // the card says it; no new ping for the same question
    if (!process.env.JOB_PILOTTO_SMOKE && Notification.isSupported()) {
      const note = new Notification({title: `Needs your input · ${what}`, body: text});
      note.on('click', () => { getWindow()?.show(); getWindow()?.focus(); toWindow('session', 'open', {id: session.id}); });
      note.show();
    }
    toWindow('toast', {title: `Needs your input · ${what}`, body: text, target: targets.clean({view: 'sessions', session: session.id}), tone: 'warn'});   // a click opens its card
    // Not on Telegram: a session waiting for you is answered in the app, and the pings added noise (1 Oct 2026).
  }
  return {skipUntilNotion, focusReminder, resumeQueue, sessionNeedsYou};
}

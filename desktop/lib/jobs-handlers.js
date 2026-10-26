// The jobs and runs IPC (moved out of main.js, 8 Oct 2026): the page's view of a run, the runs list and a run's detail, checking mail, the first search,
// the logs (days, tail, search, show), the jobs list and the calendar's jobs, the cached view and a refresh. main.js passes in the services they
// share. Guards: the jobs, runs, logs and shared-read tests in desktop/test.
import * as analyticsLib from './analytics.js';
import * as cvlib from './cv.js';
import * as github from './github.js';
import * as logView from './log-view.js';
import * as pipeline from './pipeline.js';
import * as runHistory from './run-history.js';
import * as server from './server.js';
import * as viewCache from './view-cache.js';
import fs from 'node:fs';
import path from 'node:path';
import {log as appLog, logFile} from './log.js';
import {sharedRead} from './shared-read.js';
import {demoPath} from './demo.js';
import {hideJobsUntilSearched} from './demo-search.js';
import {searchTrigger} from './search-steps.js';

export function registerJobsHandlers(ctx) {
  const {DEMO, JOBS_PAGE, activity, aiGate = async () => null, allowanceBlock, app, cloud, dispatchCloud, here, ipcMain, log, needsNotion, shell, storage, toWindow, track} = ctx;
  let jobsLimit = JOBS_PAGE;   // how many rows the list sends; \"Show more\" raises it for the rest of this launch
  // The page the person opened (a name from a fixed list, nothing else): where people go, in order.
  ipcMain.handle('pageView', (_, name) => { if (analyticsLib.PAGES.includes(String(name))) track('page_view', {page: String(name)}); return true; });
  // Seconds on a screen (active vs idle) and clicks on named controls with their place in the window: fixed shapes, validated in lib/analytics.js usageEvent.
  ipcMain.handle('usage', (_, payload) => { const event = analyticsLib.usageEvent(payload); if (event) track(event.name, event.props); return true; });
  ipcMain.handle('runs', () => activity());
  // Pages are logged by their LAST 8 characters: the first 8 are the workspace's, the same on every page (6 Oct 2026: a log of reads could not tell them apart).
  ipcMain.handle('runDetail', async (_, pageId) => {
    if (DEMO) return JSON.parse(fs.readFileSync(demoPath(here, 'run-pages.json'), 'utf8'))[pageId] || {message: null, log: []};
    try {
      const started = Date.now(), read = await runHistory.detail(storage, pageId);
      appLog('run', 'page read', {page: String(pageId).replace(/-/g, '').slice(-8), message: !!read.message, lines: read.log.length, ms: Date.now() - started});
      return read;
    } catch (error) {
      appLog('run', 'page not read', {page: String(pageId).replace(/-/g, '').slice(-8), error: error.message, status: error.status || 0});
      return {message: null, log: [`Not read from Notion: ${error.message}`]};
    }
  });

  // Check mail reads the e-mails with AI: refused while our AI cannot take a step (no credit, a Free AI line), never for the trial's end.
  ipcMain.handle('checkMail', async () => (await aiGate()) || (cloud()
    ? dispatchCloud('Gmail check (Check now)', {}, 'mail.yml').then(result => (result.ok
      ? {ok: true, cloud: true} : {ok: false, error: result.error}))
    : pipeline.checkMail(storage, log, 'you').then(({ok, run}) => ({ok, run}))));
  // The list sends the best `jobsLimit` rows; "Show more" raises it for the rest of this launch, so a refresh after a search keeps them.
  // The window's own line for logs/app.log, area "ui": what a person saw that the app's side can't tell (7 Oct 2026: a counter that
  // flashed only sometimes). Short identity fields only (numbers, flags, names), never a job or anything the user wrote.
  // Settings → Logs (lib/log-view.js): one day's page of lines or a capped search at a time, never a whole file.
  const logsFolder = () => path.dirname(logFile() || path.join(app.getPath('userData'), 'logs', 'app.log'));
  ipcMain.handle('logsDays', (_, name) => logView.days(logsFolder(), String(name)));
  ipcMain.handle('logsTail', (_, name, options = {}) => logView.tail(logsFolder(), String(name),
    {day: String(options?.day || 'today'), skip: Number(options?.skip) || 0}));
  ipcMain.handle('logsSearch', (_, name, query, options = {}) => logView.search(logsFolder(), String(name), String(query || ''),
    {day: String(options?.day || '')}));
  ipcMain.handle('logsShow', (_, name, day) => {
    const file = logView.files(logsFolder(), String(name), String(day || 'today'))[0];
    if (file) shell.showItemInFolder(file); else shell.openPath(logsFolder());
  });
  ipcMain.handle('uiLog', (_, message, fields = {}) => {
    const kept = Object.entries(fields && typeof fields === 'object' ? fields : {}).slice(0, 12)
      .map(([key, value]) => [String(key).slice(0, 40), typeof value === 'number' || typeof value === 'boolean' ? value : String(value).slice(0, 60)]);
    appLog('ui', String(message).slice(0, 120), Object.fromEntries(kept));
  });
  ipcMain.handle('jobs', sharedRead('jobs', async (_, options = {}) => {
    if (options?.limit) jobsLimit = Math.max(JOBS_PAGE, Math.round(options.limit));
    if (DEMO) return hideJobsUntilSearched(JSON.parse(fs.readFileSync(demoPath(here, 'jobs.json'), 'utf8')), storage.settings());
    // Searches run in the cloud: show the latest cloud run's jobs (checked at most every 5 minutes).
    const cloud = storage.settings().cloud;
    if (cloud?.repo && Date.now() - Date.parse(cloud.checkedAt || 0) > 5 * 60 * 1000) {
      storage.saveSettings({cloud: {...cloud, checkedAt: new Date().toISOString()}});
      await github.syncDatabase(storage).catch(error => log(`Cloud job list: ${error.message}`));
    }
    const result = await pipeline.jobs(storage, jobsLimit);
    for (const job of result.jobs || []) job.tailored = !!job.code && cvlib.exists(storage, job.code);
    // A session whose job is already Applied is over (the form was submitted): the extension's report can arrive
    // while the app is closing, so this cannot wait for the window to notice. Cheap and idempotent.
    const ended = server.reconcileAppliedSessions(result.jobs || []);
    if (ended.length) {
      appLog('sessions', `Ended ${ended.length} session(s) whose job is already Applied`, {urls: ended});
      toWindow('session', 'update', {ended});
    }
    return viewCache.remember(storage, 'jobs', result);
  }, {keyOf: (_, options) => options?.limit || '', log: appLog}));
  ipcMain.handle('calendarJobs', sharedRead('calendarJobs', async () => (DEMO ? {jobs: JSON.parse(fs.readFileSync(demoPath(here, 'jobs.json'), 'utf8')).jobs}
    : needsNotion('interviews') || viewCache.remember(storage, 'calendar', await pipeline.calendarJobs(storage))), {log: appLog}));
  // The last good Jobs / Focus / Strategy read, shown at once while the fresh one loads (lib/view-cache.js).
  ipcMain.handle('cached', (_, name) => (DEMO ? null : viewCache.recall(storage, name)));
  // why: a fixed reason from the window ({reason: 'rescore', count}), said on the run's row; never free text. {employers: true}: the finder runs too, whatever its day limit.
  ipcMain.handle('refresh', async (_, why = {}) => {
    const blocked = await allowanceBlock();
    if (blocked) return blocked;
    const count = Math.max(0, Math.round(Number(why?.count) || 0));
    const note = why?.reason === 'rescore' && count ? `Re-scoring ${count} older score${count === 1 ? '' : 's'}` : '';
    if (!cloud()) return pipeline.refresh(storage, log, 'run', searchTrigger(storage.settings()), {note, employers: !!why?.employers});
    const started = await dispatchCloud('Run now (Refresh)', {mode: 'run'});
    return started.ok ? {ok: true, cloud: true} : {ok: false, error: started.error};
  });
}

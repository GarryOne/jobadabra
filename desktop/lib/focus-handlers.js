// The jobs, focus and status IPC (moved out of main.js, 8 Oct 2026): the theme and automation switches, deleting a job and setting its status, the Focus
// page's list, the daily target and audience, interview prep, describing a job, reassigning an email, focus history, outcomes and the rejection
// review. main.js passes in the services they share. Guards: the focus, targets and status tests in desktop/test.
import * as notionGate from './notion-gate.js';
import {forWindow} from './site-accounts.js';
import * as pipeline from './pipeline.js';
import * as server from './server.js';
import * as strategy from './strategy.js';
import * as viewCache from './view-cache.js';
import fs from 'node:fs';
import path from 'node:path';
import {log as appLog} from './log.js';
import {afterWrite, sharedRead} from './shared-read.js';
import {demoPath} from './demo.js';

export function registerFocusHandlers(ctx) {
  const writeHandle = (channel, fn) => ipcMain.handle(channel, afterWrite(fn));   // a finished write closes the running reads' join (shared-read.js)
  const {DEMO, aiReady, app, applyTheme, clearlyTechnical, here, ipcMain, log, needsNotion, settingsDeps, storage, toWindow, track} = ctx;
  ipcMain.handle('setTheme', (_, value) => { const theme = applyTheme(value); storage.saveSettings({theme}); return theme; });
  ipcMain.handle('setAutomation', (_, patch) => {
    const allowed = {};
    if ('autoSearch' in patch) allowed.autoSearch = !!patch.autoSearch;
    if ('openAtLogin' in patch) { allowed.openAtLogin = !!patch.openAtLogin; app.setLoginItemSettings({openAtLogin: allowed.openAtLogin}); }
    return forWindow(storage.saveSettings(allowed));
  });
  // Every Applied decision lands in the log, whoever made it: the two buttons here, the extension's own report
  // (server.js), and a mistaken one's undo (notSubmitted below). "Who decided this, and why?" is answerable from
  // logs/app.log alone (1 Oct 2026).
  ipcMain.handle('deleteJob', async (_, url) => {
    if (DEMO) return {ok: true, trashed: 0};
    const result = await pipeline.deleteJob(storage, String(url)).catch(error => ({ok: false, error: error.message}));
    let host = ''; try { host = new URL(String(url)).hostname; } catch { /* not an address */ }
    appLog('jobs', result?.ok ? 'deleted a dismissed job' : 'job not deleted', {host, trashed: result?.trashed ?? 0, by: 'you', error: result?.ok ? undefined : result?.error});
    return result;
  });
  ipcMain.handle('setStatus', async (_, url, status) => {
    const reason = notionGate.statusReason(status);
    const gate = reason && needsNotion(reason);
    if (gate) return gate;
    if (status !== 'applied') {
      return pipeline.setStatus(storage, url, status);   // pipeline-commands.js mirrors it in the view cache
    }
    const job = String(url);
    appLog('applied', `asked from the app (you): ${job}`);
    const result = await pipeline.setStatus(storage, job, status).catch(error => ({ok: false, error: error.message}));
    appLog('applied', `asked from the app (you): ${job} -> ${result?.ok ? 'marked applied' : result?.error || 'failed'}`);
    if (result?.ok) { track('applied', {how: 'manual'}); server.sessionSubmitted(job); }   // the job is Applied: its sessions are over, as for a submit the extension saw
    return result;
  });
  // Focus: what to do next (Notion, no AI); Done on a reply logs a "Replied" event.
  // Demo mode: the fictional list in demo/focus.json (JOBADABRA_DEMO_FOCUS_DELAY ms first, to see the loading state;
  // JOBADABRA_DEMO_FOCUS=<file> another fictional list, e.g. e2e/mail-states.mjs's open and answered questions).
  // Demo mode remembers what you do there, as Notion would for a person: an answered "which job?" leaves Focus and is
  // answered, a built prep kit is ready. Without it every re-read of the file undid it (owner, 6 Oct 2026).
  let demoFocus = null;
  const demoFocusData = () => demoFocus || (demoFocus = JSON.parse(fs.readFileSync(process.env.JOBADABRA_DEMO_FOCUS || demoPath(here, 'focus.json'), 'utf8')));
  ipcMain.handle('focus', sharedRead('focus', async () => {
    const gate = needsNotion('focus');
    if (gate) return gate;
    if (!DEMO) return viewCache.remember(storage, 'focus', await pipeline.focus(storage));
    await new Promise(resolve => setTimeout(resolve, Number(process.env.JOBADABRA_DEMO_FOCUS_DELAY) || 0));
    return {ok: true, focus: demoFocusData()};
  }, {log: appLog}));
  // The daily applications target lives on ⚙️ Search settings in Notion (Focus, Settings and the wizard set it).
  ipcMain.handle('dailyTarget', () => ({target: DEMO ? JSON.parse(fs.readFileSync(demoPath(here, 'focus.json'), 'utf8')).today.target : strategy.dailyTarget(storage), reminders: storage.settings().focusReminders !== false}));
  // Is the candidate looking for IT work? The tips keep their IT examples for those who are (renderer/audience.js; with no roles known yet the general version is shown).
  ipcMain.handle('audience', () => {
    if (DEMO) return {technical: true};   // the demo candidate is an SRE
    let keywords = [], places = [];
    try {
      const search = JSON.parse(fs.readFileSync(path.join(storage.path('config'), 'search.json'), 'utf8'));
      keywords = search.role_keywords || [];
      places = ['top_tier', 'country_wide', 'abroad'].flatMap(key => search.locations?.[key] || []);   // top cities first: the first one is the candidate's own example
    } catch { /* no search yet */ }
    return {technical: clearlyTechnical(keywords), places: places.slice(0, 12)};
  });
  ipcMain.handle('setDailyTarget', async (_, value) => {
    if (DEMO) return {ok: true, target: strategy.clampTarget(value)};
    const gate = needsNotion('focus');
    if (gate) return gate;
    try {
      return {ok: true, target: await strategy.setDailyTarget(storage, value, settingsDeps())};
    } catch (error) { return {ok: false, error: `Notion: ${error.message}. The target wasn't changed.`}; }
  });
  // Demo mode: a fictional history.
  const demoHistory = () => {
    const at = (days, hour) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 11) + `${String(hour).padStart(2, '0')}:10:00Z`;
    return {ok: true, items: [
      {at: at(0, 9), kind: 'Replied', emoji: '💬', title: 'Replied to Northwind Robotics', note: 'You answered (marked done in Focus)', url: ''},
      {at: at(1, 17), kind: 'insight', emoji: '💡', title: 'Insight: Useful', note: 'Location requirements may be limiting your applications', url: ''},
      {at: at(1, 11), kind: 'Feedback requested', emoji: '🙋', title: 'Asked Example Labs for feedback', note: '', url: ''},
      {at: at(3, 15), kind: 'Feedback skipped', emoji: '⏭️', title: 'Skipped asking Acme Robotics for feedback', note: '', url: ''}]};
  };
  // Interview prep kit (Focus → Prepare): runs here (you wait for it), steps shown in its dialog.
  ipcMain.handle('interviewPrep', (_, pageId) => {
    if (DEMO) {
      const item = demoFocusData().items.find(one => one.kind === 'prepare' && one.page_id === pageId);
      if (item) Object.assign(item, {prep_at: new Date().toLocaleDateString('en-CA'), prep_stale: false});
      return {ok: true, text: 'Prep kit ready (demo): nothing was written.'};
    }
    if (!aiReady()) return {ok: false, text: 'The prep kit needs AI: choose an AI engine: Claude Code, Codex or an API key (Settings → Connections → AI).'};
    // Its lines and result also go to logs/app.log (a failed kit left no trace before).
    return pipeline.interviewPrep(storage, String(pageId), line => {
      log(line);
      appLog('prep', line);
      if (/^⏳/.test(line)) toWindow('prepStep', line.replace(/^⏳\s*/, ''));
    }).then(result => { appLog('prep', `${pageId}: ${result?.ok ? 'ready' : 'failed'}`, {text: result?.text || result?.error}); return result; });
  });
  ipcMain.handle('describeJob', (_, pageId, text = '', url = '') => (DEMO ? {ok: true, text: 'Saved (demo).'}
    : pipeline.describeJob(storage, String(pageId), String(text || ''), String(url || ''))));
  // Where an email belongs: Focus → "Is this about …?" (src/ai/reassign.py).
  ipcMain.handle('reassignEmail', (_, eventId, target) => {
    if (!DEMO) return pipeline.reassignEmail(storage, String(eventId), String(target));
    const focus = demoFocusData();
    const at = focus.items.findIndex(one => one.kind === 'which_job' && one.event_id === eventId);
    if (at >= 0) {
      const [item] = focus.items.splice(at, 1);
      const job = JSON.parse(fs.readFileSync(demoPath(here, 'jobs.json'), 'utf8')).jobs.find(one => one.url === target);
      const label = target === 'none' ? '' : job ? `${job.company || job.via} — ${job.title}` : `${item.company || 'New job'} — new job`;
      focus.answered_questions = [{subject: item.subject, job: label, at: new Date().toISOString()}, ...(focus.answered_questions || [])];
    }
    return {ok: true, text: 'Moved (demo): nothing was written.'};
  });
  ipcMain.handle('focusHistory', () => (DEMO ? demoHistory() : needsNotion('focus') || pipeline.focusHistory(storage)));
  ipcMain.handle('focusDone', (_, pageId, what = 'replied') => (DEMO ? {ok: true} : needsNotion('focus') || pipeline.focusDone(storage, String(pageId), String(what))));
  // Focus → "Did the interview happen?": held (notes), moved (a new time) or cancelled; Notion first.
  writeHandle('interviewHappened', (_, pageId, answer, detail = {}) => (DEMO ? {ok: true, review: false}
    : pipeline.interviewHappened(storage, String(pageId), String(answer), detail || {})));
  ipcMain.handle('feedbackAction', (_, pageId, action, text = '') => (DEMO ? {ok: true}
    : pipeline.feedbackAction(storage, String(pageId), String(action), String(text))));
  // A rejected job's menu → Why was I rejected? (also runs by itself after the Gmail check logs a rejection).
  ipcMain.handle('reviewRejection', async (_, url) => {
    if (DEMO) return {ok: true, text: 'Reviewed (demo): nothing was written.'};
    if (!aiReady()) return {ok: false, text: 'The review needs AI: choose an AI engine: Claude Code, Codex or an API key (Settings → Connections → AI).'};
    try { return await pipeline.reviewRejection(storage, url, log); } catch (error) { return {ok: false, text: error.message}; }
  });
}

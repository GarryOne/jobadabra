// The Interviews page's IPC (moved out of main.js, 8 Oct 2026): drafts on this Mac (recording, transcribing, editing), saved interviews in
// Notion 🎤 Interviews, their review and the recordings folder. Demo mode shows fictional ones and changes nothing. main.js passes in the
// services it shares (registerInterviewHandlers). Guards: interviews tests in desktop/test and the interviews e2e suite.
import {afterWrite} from './shared-read.js';
import fs from 'node:fs';
import path from 'node:path';
import * as storeEngine from './store/engine.js';
import {byStore} from './store/words.js';
import {demoPath} from './demo.js';

export function registerInterviewHandlers(ctx) {
  const writeHandle = (channel, fn) => ipcMain.handle(channel, afterWrite(fn));   // a finished write closes the running reads' join (shared-read.js)
  const {appLog, calltap, cloud, DEMO, dialog, dispatchCloud, handleImportant, here, interviews, ipcMain, needsNotion, notify, reminders, sharedRead, shell, storage, toWindow, viewCache, getWindow} = ctx;
  // Interviews: drafts on this Mac (recording, transcribing, editing), saved ones in Notion 🎤 Interviews.
  // Demo mode shows fictional ones (demo/interviews.json) and changes nothing.
  const demoInterviews = () => JSON.parse(fs.readFileSync(demoPath(here, 'interviews.json'), 'utf8'));
  // Recordings made in the app are matched to the job whose Next interview time is close to when they began (a suggestion only:
  // the job is confirmed by saving). Imported files have no real start time, so they get none.
  ipcMain.handle('ivDrafts', () => {
    if (DEMO) return [demoInterviews().draft];
    const jobs = viewCache.recall(storage, 'jobs')?.result?.jobs || [];
    return interviews.drafts(storage).map(draft => {
      if (draft.jobUrl || draft.file !== 'recording.webm') return draft;
      const found = reminders.match(jobs, Date.parse(draft.createdAt));
      return found ? {...draft, suggestedJobUrl: found.url, suggestedJob: `${found.company} — ${found.title}`} : draft;
    });
  });
  ipcMain.handle('ivRemindGet', () => ({on: reminders.on(storage)}));
  ipcMain.handle('ivRemindSet', (_, value) => { storage.saveSettings({interviewReminders: !!value}); return {on: !!value}; });
  ipcMain.handle('ivTranscript', (_, id) => (DEMO ? demoInterviews().transcript : interviews.transcript(storage, id)));
  ipcMain.handle('ivSaved', sharedRead('ivSaved', async () => (DEMO ? {ok: true, interviews: demoInterviews().saved, insight: demoInterviews().insight}
    : needsNotion('interviews') || viewCache.remember(storage, 'interviews', await interviews.saved(storage))), {log: appLog}));
  ipcMain.handle('calendarRecordings', sharedRead('calendarRecordings', async () => (DEMO ? {ok: true, interviews: demoInterviews().saved}
    : needsNotion('interviews') || viewCache.remember(storage, 'calendarRecordings', await interviews.savedForCalendar(storage))), {log: appLog}));
  ipcMain.handle('ivInsightStep', async (_, text, done) => (DEMO ? {ok: true, done_steps: []}
    : needsNotion('interviews') || interviews.insightStep(storage, text, !!done)));
  ipcMain.handle('ivInsights', async () => {
    if (DEMO) return {ok: true, status: 'unchanged', text: 'Demo mode', insight: demoInterviews().insight};
    const gate = needsNotion('interviews');
    if (gate) return gate;
    const result = await interviews.refreshInsights(storage);
    const cached = interviews.cacheWithInsight(viewCache.recall(storage, 'interviews'), result);
    if (cached) viewCache.remember(storage, 'interviews', cached);  // the next start shows this one
    return result;
  });
  handleImportant('ivAdd', 'Saving an interview', async () => {
    const picked = await dialog.showOpenDialog(getWindow(), {title: 'Choose an interview recording or transcript',
      filters: [{name: 'Recording or transcript', extensions: [...interviews.AUDIO, ...interviews.TEXT]}], properties: ['openFile']});
    if (picked.canceled || !picked.filePaths[0]) return null;
    let draft;
    try { draft = interviews.add(storage, picked.filePaths[0]); } catch (error) { return {error: error.message}; }
    // A transcript file is ready at once: it goes to Notion now, like a finished transcription.
    return draft.status === 'ready' ? (await interviews.toNotion(storage, draft.id).catch(() => null)) || draft : draft;
  });
  ipcMain.handle('ivRecordStart', (_, options) => interviews.startRecording(storage, options));
  ipcMain.handle('ivRecordChunk', (_, id, bytes) => { interviews.appendRecording(storage, id, bytes); return true; });
  ipcMain.handle('ivRecordStop', async (_, id, seconds, extra) => {
    const tap = await calltap.stop(id);
    return interviews.stopRecording(storage, id, seconds, {...extra, ...(tap ? {callFile: 'call.pcm', callStartedAt: tap.startedAt} : {})});
  });
  // The call's audio through AudioTee (Core Audio taps, macOS 14.2+; "System Audio Recording Only" permission).
  const tapReady = () => !DEMO && !!calltap.binary() && Number(process.getSystemVersion().split('.')[0]) >= 14
    && !(process.getSystemVersion().startsWith('14.') && Number(process.getSystemVersion().split('.')[1] || 0) < 2);
  ipcMain.handle('ivTapAvailable', () => tapReady());
  ipcMain.handle('ivTapStart', async (_, id) => {
    try {
      const file = path.join(storage.path('interviews'), String(id).replace(/[^\w-]/g, ''), 'call.pcm');
      let last = 0;
      const {startedAt} = await calltap.start(id, file, level => {
        if (Date.now() - last > 200) { last = Date.now(); toWindow('ivLevel', {id, level}); }
      });
      return {ok: true, startedAt};
    } catch (error) {
      return {ok: false, error: error.message};
    }
  });
  ipcMain.handle('ivPrefetch', () => (DEMO ? {ok: true} : interviews.prefetch(storage, step => toWindow('ivProgress', step))));
  handleImportant('ivTranscribe', 'Transcribing an interview', async (_, id, options) => {
    const meta = await interviews.transcribe(storage, id, options, step => toWindow('ivProgress', step));
    if (meta.status === 'ready') notify('Transcript ready', `${meta.title}: ${meta.pageId ? byStore(storage, 'already in your Notion; ', 'already saved; ') : ''}name the speakers, pick the job, then Save.`, {view: 'interviews'}, 'good');
    return meta;
  });
  ipcMain.handle('ivSaveDraft', (_, id, patch) => (DEMO ? true : interviews.saveDraft(storage, id, patch)));
  ipcMain.handle('ivDiscard', async (_, id) => (DEMO ? (interviews.discard(storage, id), true) : (await interviews.drop(storage, id)).ok));
  writeHandle('ivSave', (_, id) => needsNotion('interviews') || interviews.save(storage, id));
  ipcMain.handle('ivLink', (_, pageId, jobUrl) => needsNotion('interviews') || interviews.link(storage, pageId, jobUrl));
  // A row already reviewed is reviewed again by the same run (⋯ Review again: src/ai/interviews.py review_again).
  // One review costs ~$0.25 and takes about a minute, so a second ask for the same interview inside that window is a
  // duplicate, whoever made it: 1 Oct 2026 produced two GitHub runs 38 s apart, two Notion rows and two different
  // reviews of one transcript. The window is short enough that a deliberate "Review again" later still runs.
  const REVIEW_WINDOW_MS = 2 * 60 * 1000;
  const reviewingStarted = new Map();  // interview page id -> when its review was last started
  // `why` comes from the window (the row's Review, ⋯ Review again, Save & review): the log then names the button, not
  // just "the app", which is what makes a second dispatch attributable.
  ipcMain.handle('ivReview', (_, pageId, why = '') => {
    if (DEMO) return {ok: true, summary: 'Reviewed (demo): nothing was written'};
    const gate = needsNotion('interviews');
    if (gate) return gate;
    const id = String(pageId), caller = `Interview review (${why || 'interviews page'})`;
    if (Date.now() - (reviewingStarted.get(id) || 0) < REVIEW_WINDOW_MS) {
      appLog('dispatch', `refused ${caller} → daily.yml (interview) in ${storage.settings().cloud?.repo || 'this Mac'}: already started within ${REVIEW_WINDOW_MS / 60000} min`);
      return {ok: true, already: true, summary: 'Already reviewing this interview — it shows in Recent activity'};
    }
    reviewingStarted.set(id, Date.now());
    if (cloud()) {
      return dispatchCloud(caller, {mode: 'interview', interview: id}).then(started => (started.ok
        ? {ok: true, cloud: true, summary: 'Reviewing on GitHub: it shows in Recent activity, and the review lands on the interview in Notion.'}   // about Notion: Always on needs Notion
        : {ok: false, error: `Could not start the review on GitHub: ${started.error}`}));
    }
    return Promise.resolve(interviews.review(storage, id)).then(result => {
      if (!result?.ok) reviewingStarted.delete(id);  // it failed: a retry must be able to start at once
      return result;
    });
  });
  writeHandle('ivDelete', (_, pageId) => (DEMO ? {ok: true} : interviews.remove(storage, pageId)));
  // Interviews → Open review with no page to open (the data on this Mac): the interview's record from the store, for the app's own view.
  ipcMain.handle('ivRecord', async (_, id) => {
    if (DEMO) return demoInterviews().records?.[String(id)] || null;   // a fictional interview with no Notion page: its review in the app
    try { return await storeEngine.call(storage, 'interviews', 'get', {interview_id: String(id)}); } catch (error) { return {error: error.message}; }
  });
  ipcMain.handle('ivRecordings', () => {
    fs.mkdirSync(storage.path('recordings'), {recursive: true});
    return shell.openPath(storage.path('recordings'));
  });
}

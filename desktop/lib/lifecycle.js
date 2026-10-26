// Testable Electron startup, activation, quit decisions and terminal shutdown; services are injected.
import * as quitDialog from './quit-dialog.js';
import {NO_PLACE} from '../renderer/targets.js';

export function claimInstance({app, showDuplicate, getWindow, createWindow}) {
  const firstCopy = app.requestSingleInstanceLock();
  if (!firstCopy) app.whenReady().then(() => { showDuplicate(); app.quit(); });
  app.on('second-instance', () => {
    if (!app.isReady()) return;
    if (!getWindow()) createWindow();
    const window = getWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  return firstCopy;
}

export function startWhenReady({app, firstCopy, start, getWindows, createWindow}) {
  if (!firstCopy) return Promise.resolve();
  return app.whenReady().then(() => {
    // false means the app moved to Applications and is opening the moved copy instead.
    if (start() === false) return;
    app.on('activate', () => { if (!getWindows().length) createWindow(); });
  });
}

export function installQuitHandling({app, platform, state, pipeline, terminals, critical = {labels: () => [], whenDone: () => Promise.resolve()}, stopDataJob = () => Promise.resolve(), dataRunning = () => false, shouldAskOnQuit,
  askWhyLeaving, showDialog, icon, getWindows, toWindow, notify, later = setTimeout, log = () => {}, onCancel = () => {}}) {
  let quitting = false;
  app.on('window-all-closed', () => { if (platform !== 'darwin') app.quit(); });
  // Any quit, asked or not (update install, last window): an export, import or backup still running is stopped and its tar awaited first, then the quit goes on.
  let dataStopped = false;
  const stopDataThenQuit = () => {
    dataStopped = true;   // once: a job that will not stop does not hold the quit again
    Promise.resolve().then(stopDataJob).catch(error => log('window', `stopping the data job failed: ${error.message}`)).then(() => app.quit());
  };
  app.on('will-quit', event => {
    if (!dataStopped && dataRunning()) { event.preventDefault(); stopDataThenQuit(); return; }   // the quit comes back here once the job is gone
    terminals.shutdown();
  });
  const beforeQuit = event => {
    const {storage, window, telemetry, demo, smoke} = state();
    if (quitting || demo || smoke) return;
    if (storage && window && !window.isDestroyed() && shouldAskOnQuit(storage.settings(), !!telemetry?.enabled())) {
      event.preventDefault();
      storage.saveSettings({leaveAsked: true});
      window.show();
      askWhyLeaving();
      later(() => app.quit(), 5 * 60 * 1000);
      log('window', 'quit deferred for setup feedback');
      return;
    }
    const busy = pipeline.running(), queue = pipeline.queued();
    const sessions = terminals.running().filter(session => session.status === 'running');
    const important = critical.labels();   // an export, a Notion workspace being built…: never cut off without asking
    if (!busy && !queue.length && !sessions.length && !important.length) return;
    event.preventDefault();
    const label = session => session.company || terminals.label(session);
    const show = (dialog, cancelId) => showDialog(getWindows()[0], {
      type: 'none', icon: icon(), ...dialog, defaultId: 0, cancelId,
    });
    if (!busy && !queue.length && !important.length) {
      const choice = show(quitDialog.sessionsOnly(sessions, label), 0);
      log('window', 'quit decision', {choice: choice === 0 ? 'keep sessions' : 'stop sessions', sessions: sessions.length});
      if (choice === 0) { onCancel(); window?.show(); toWindow('session', 'open', {id: sessions[0].id}); return; }
      quitting = true;
      app.quit();
      return;
    }
    const dialog = quitDialog.working({busy, queue, sessions, important, label, taskName: pipeline.taskName});
    const choice = show(dialog, 2);
    log('window', 'quit decision', {choice: ['when idle', 'now', 'cancel'][choice], queued: queue.length, sessions: sessions.length, important: important.join(', ')});
    if (choice === 2) { onCancel(); return; }
    quitting = true;
    if (choice === 1) {
      pipeline.freezeQueue(storage);
      pipeline.stopRunning();
      if (dataRunning()) stopDataThenQuit();   // the data job's tar is gone before the app goes
      else app.quit();
      return;
    }
    notify('Jobadabra will quit when done', dialog.detail, NO_PLACE.app, 'info');
    Promise.all([pipeline.whenIdle(), critical.whenDone()]).then(() => app.quit());
  };
  app.on('before-quit', beforeQuit);
  return beforeQuit;
}

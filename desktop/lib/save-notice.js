// Tells the person when a private file could not be saved yet (lib/private-file.js: Windows held it too long) and lets them Retry; at quit, a save still waiting is finished or reported.
// Wording is the owner's states (28 Oct 2026): "waiting for the file" is quiet, "could not save" is a pop-up whose click is Retry (no button in a pop-up). Guard: test/save-notice.test.js.
import path from 'node:path';
import {NO_PLACE} from '../renderer/targets.js';
import {flushPending, onChange, retryPrivate} from './private-file.js';

/** The pop-up for a file that could not be saved; `retrySave` is the file, the window turns it into the click action. */
export function failedToast(file) {
  const name = path.basename(file);
  return {title: `Could not save ${name} yet`, body: 'Windows is still using it, maybe a virus scan. Your latest change is kept and nothing is lost.', tone: 'warn', target: NO_PLACE.itself, retrySave: file};   // the click is Retry (renderer/pages/startup.js), nothing else to open
}

/** The text of the last-chance message at quit for files still waiting. */
export function quitMessage(files) {
  return `These could not be saved because Windows is still using them:\n${files.map(file => path.basename(file)).join('\n')}\n\nYour latest changes are lost if you quit now.`;
}

/**
 * Starts the notice: a 'could not save' pop-up to the window (toWindow('toast', ...)), the 'retrySave' IPC (true when a waiting save was retried, false when none waits),
 * and at 'will-quit' a last try whose leftovers go into a native message box. Takes the Electron parts from main.js; returns nothing; a listener error never stops a save.
 */
export function watchSaves({ipcMain, app, dialog, toWindow}) {
  onChange(({file, state}) => { if (state !== 'failed') return; const toast = failedToast(file); toWindow('toast', toast); });
  ipcMain.handle('retrySave', (_, file) => retryPrivate(String(file)));   // only a file that is waiting can be retried
  app.on('will-quit', () => {
    const left = flushPending();
    if (left.length) dialog.showMessageBoxSync({type: 'warning', message: 'Some changes were not saved', detail: quitMessage(left), buttons: ['OK']});
  });
}

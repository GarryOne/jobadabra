// The hosted Always on IPC (private spec jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md §4): turn it on or off, read its state, download my data, push the profile again after a change.
// main.js passes in the services they share. Guard: test/hosted-search.test.js and test/ipc.test.js.
import * as hosted from './hosted-search.js';
import * as pipeline from './pipeline.js';
import {emailOf} from './notify-channel.js';
import {turnOnShared} from './hosted-email.js';

export function registerHostedHandlers({DEMO, dialog, getWindow, ipcMain, storage, toWindow}) {
  const engine = args => pipeline.run(storage, args);
  ipcMain.handle('hostedState', async () => ({...hosted.state(storage), shared: DEMO ? 'alex@example.com' : emailOf(storage), available: !DEMO, schedule: !DEMO && hosted.state(storage).on ? await hosted.schedule(storage) : null}));
  ipcMain.handle('hostedOn', async (_, given) => {
    if (DEMO) return {ok: true};
    const done = await turnOnShared(storage, given || {});   // the Notifications address (#1711); one typed in the setup step becomes it
    if (done.ok) hosted.pullInbox(storage, engine).then(pulled => { if (pulled.added) toWindow('hostedArrived', pulled); }).catch(() => {});
    return done;
  });
  ipcMain.handle('hostedOff', async () => (DEMO ? {ok: true} : hosted.turnOff(storage)));
  ipcMain.handle('hostedPush', async () => (DEMO || !hosted.state(storage).on ? {ok: true} : hosted.pushConfig(storage)));
  ipcMain.handle('hostedExport', async () => {
    if (DEMO) return {ok: true};
    const win = getWindow();
    const {canceled, filePath} = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, {defaultPath: 'job-pilotto-hosted-data.json', filters: [{name: 'JSON', extensions: ['json']}]});
    return canceled || !filePath ? {ok: false, cancelled: true} : hosted.exportTo(storage, filePath);
  });
  if (!DEMO && hosted.state(storage).on) hosted.pushConfig(storage).catch(() => {});   // the profile and search settings as they are now (they may have changed since)
  if (!DEMO) hosted.keepFresh(storage, engine, pulled => toWindow('hostedArrived', pulled));
}

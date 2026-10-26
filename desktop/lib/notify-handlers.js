// Settings → Automation → Notifications over IPC: read and save "Tell me by" and the e-mail address (lib/notify-channel.js). Demo mode never reaches our site.
// Guarded by test/notify-channel.test.js and test/ipc.test.js.
import * as channel from './notify-channel.js';

export function registerNotifyHandlers({ipcMain, storage, DEMO, log}) {
  ipcMain.handle('notifyState', async () => {
    if (DEMO) return {by: ['email', 'app'], chosen: ['email', 'app'], telegram: channel.telegramReady(storage), email: 'alex@example.com', confirmed: true, marketing: true, cadence: 'daily', reached: true};
    return channel.state(storage);
  });
  ipcMain.handle('notifySave', async (_, choice) => {
    if (DEMO) return {ok: true};
    const result = await channel.save(storage, choice || {});
    log('notify', result.ok ? 'saved' : 'not saved', {by: (choice?.by || []).join(','), email: !!choice?.email, error: result.error || ''});
    return result;
  });
}

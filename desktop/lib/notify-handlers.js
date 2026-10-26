// Settings → Automation → Notifications over IPC: read and save "Tell me by" and the e-mail address (lib/notify-channel.js). Demo mode never reaches our site.
// Guarded by test/notify-channel.test.js and test/ipc.test.js.
import * as channel from './notify-channel.js';
import {followNotify} from './hosted-email.js';

export function registerNotifyHandlers({ipcMain, storage, DEMO, log}) {
  ipcMain.handle('notifyState', async () => {
    if (DEMO) return {by: ['email', 'app'], chosen: ['email', 'app'], telegram: channel.telegramReady(storage), email: 'alex@example.com', confirmed: true, marketing: true, cadence: 'daily', reached: true};
    return channel.state(storage);
  });
  ipcMain.handle('notifySave', async (_, choice) => {
    if (DEMO) return {ok: true};
    const result = await channel.save(storage, choice || {});
    log('notify', result.ok ? 'saved' : 'not saved', {by: (choice?.by || []).join(','), email: !!choice?.email, error: result.error || ''});
    if (result.ok) {   // Always on, when on, follows a changed address or news choice (#1711: one shared e-mail)
      const moved = await followNotify(storage).catch(error => ({ok: false, error: error.message}));
      if (moved.moved || !moved.ok) log('notify', moved.ok ? 'Always on follows the new address' : 'Always on did not follow the new address', {error: moved.error || ''});
      if (!moved.ok) return {...result, warning: 'Saved, but Always on still sends to your old address. Try again in a moment.'};
    }
    return result;
  });
}

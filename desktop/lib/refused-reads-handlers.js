// The extension's calls for reading refused sites in the person's browser (lib/refused-reads.js): what to read, a page it fetched, the pass ended; and the person's press of
// "Find jobs using your browser" (refusedReadStart), the only thing that starts a pass (owner, 26 Oct 2026). main.js passes in the services they share.
// Not a flow file: nothing here touches an application. Guard: test/refused-reads.test.js, test/refused-reads-button.test.js.
import {ipcMain} from 'electron';
import * as refused from './refused-reads.js';
import * as server from './server.js';
import * as now from './refused-now.js';

export function registerRefusedReadsHandlers({allowanceBlock, log, storage}) {
  // The button (a Find jobs run's result, ⌘K): the extension's one-minute look then reads the due sites.
  ipcMain.handle('refusedReadStart', () => {
    if (!refused.passRunning()) now.press();
    return {ok: true, running: refused.passRunning()};
  });
  server.setVisitRoute('/extension/refused-pending', () => ({ok: true, pending: now.pending() && !refused.passRunning(), openDetails: refused.takeOpenSwitch(storage), showCheck: refused.takeShowCheck(storage)}));   // the extension's one-minute look: the person's press waits for it
  server.setVisitRoute('/extension/refused-queue', payload => refused.queue(storage, {allowed: payload?.allowed !== false, incognito: payload?.incognito !== false, log, allowanceBlock}));
  server.setVisitRoute('/extension/refused-judge', payload => refused.judge(storage, payload));
  server.setVisitRoute('/extension/refused-outcome', payload => refused.outcome(storage, payload));
  server.setVisitRoute('/extension/refused-done', async () => { await refused.done(); return {ok: true}; });
}

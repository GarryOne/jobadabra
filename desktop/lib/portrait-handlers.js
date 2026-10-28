// Your portrait's two doors (spec 2026-10-28-your-portrait-design.md): what the tab draws, and the refresh that runs the writer (lib/portrait.js) at most once a day.
// In the demo the stored demo portrait is shown as it is; nothing reaches an account or a paid model. The only module besides the writer's tests that imports the writer.
import * as claudeCode from './claude-code.js';
import * as portrait from './portrait.js';
import * as md from './store/markdown-page.js';
import {log as appLog} from './log.js';

/** Registers the 'portrait' (what the tab draws) and 'portraitRefresh' (one writer run, at most a day) IPC handlers; both answer {ok: false, error} or a status instead of throwing. */
export function registerPortraitHandlers({DEMO, ipcMain, storage}) {
  const fail = error => ({ok: false, error: error.message});
  ipcMain.handle('portrait', async () => {
    try {
      if (!DEMO) return await portrait.status(storage);
      const record = portrait.parse(md.blocks(storage.readText('portrait.md')));   // the demo folder's own file, shown as written
      return record ? {state: 'current', sections: record.sections, evidence: record.evidence, updated: record.date, progress: []}
        : {state: 'not_yet', sections: [], evidence: {}, updated: '', progress: portrait.progressOf(portrait.countsOf({}))};
    } catch (error) { return fail(error); }
  });
  ipcMain.handle('portraitRefresh', async () => {
    if (DEMO) return {ran: false, reason: 'demo'};
    const apiKey = storage.secret('ANTHROPIC_API_KEY'), client = claudeCode.client(storage);
    if (!apiKey && !client) return {ran: false, reason: 'no_ai'};
    try {
      const result = await portrait.refresh(storage, {apiKey, client});
      if (result.ran) appLog('portrait', 'written', {usd: result.usd});
      return result;
    } catch (error) { appLog('portrait', 'run failed; the text stays', {error: error.message}); return {ran: false, reason: 'failed'}; }
  });
}

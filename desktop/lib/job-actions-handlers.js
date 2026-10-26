// The job actions' IPC (moved out of main.js, 8 Oct 2026): running a Telegram-style command from the app, adding a job or an applied one by hand, standard
// answers, re-scoring older scores, the reasons for dismissing a job and the anonymous intel snapshot. main.js passes in the services they
// share. Guards: the command, add-job and rescore tests in desktop/test.
import * as applicationOutcomes from './outcomes.js';
import * as controlEvents from './control-events.js';
import * as pipeline from './pipeline.js';
import * as questions from './questions.js';
import * as questionLists from './question-lists.js';
import * as telegram from './telegram.js';
import {log as appLog} from './log.js';

export function registerJobActionsHandlers(ctx) {
  const {DEMO, allowanceBlock, cloud, dispatchCloud, dispatchNote, intelLib, ipcMain, log, needsNotion, getRecipeReporter, storage} = ctx;
  // Prepare top matches (Actions): kits for the best-scored matches without one, tracked like the other tasks. Not a Telegram
  // command; with Always on it runs in the user's GitHub repo like every background job.
  const prepareTopMatches = async () => {
    const gate = needsNotion('kits');
    if (gate) return gate;
    const blocked = await allowanceBlock();
    if (blocked) return blocked;
    appLog('dispatch', 'prepare top matches', {where: cloud() ? 'github' : 'mac'});
    if (cloud()) {
      const started = await dispatchCloud('Prepare top matches', {mode: 'kits'});
      return {text: started.ok ? 'Drafting kits for your top matches on GitHub.' : `⚠️ ${started.error}`};
    }
    pipeline.task(storage, 'kits', pipeline.dailyArgs(storage, {mode: 'kits'}), log).catch(error => log(`Prepare top matches failed: ${error.message}`));
    return {text: 'Drafting kits for your top matches.'};
  };
  // Every Telegram command, from the app (the answer also goes to Telegram when connected).
  const COMMANDS = ['check', 'employers', 'run', 'today', 'applied', 'saved', 'insight', 'weekly', 'mail', 'scout', 'status', 'add', 'help'];
  ipcMain.handle('command', async (_, name, arg = '') => {
    if (name === 'kits') return prepareTopMatches();
    if (!COMMANDS.includes(name)) return {text: 'Unknown command'};
    const blocked = name === 'run' ? await allowanceBlock() : null;   // its own reason (no AI credit, trial over), never a fixed "trial is over"
    if (blocked) return {...blocked, text: `⚠️ ${blocked.error}`};
    try { return await telegram.runCommand(storage, name, arg, log, undefined, dispatchNote); } catch (error) { return {text: `⚠️ ${error.message}`}; }
  });
  // Jobs → Applied elsewhere: tracked like /add, but waited for, so the list shows it as Applied right away.
  ipcMain.handle('importJob', async (_, url) => {
    if (DEMO) return {ok: true, text: 'Added (demo): nothing was written.'};
    const gate = needsNotion('add');
    if (gate) return gate;
    try { return await pipeline.importJob(storage, url, log); } catch (error) { return {ok: false, text: error.message}; }
  });
  ipcMain.handle('addApplied', async (_, url, when = '', details = {}) => {
    if (DEMO) return {ok: true, text: 'Tracked (demo): nothing was written.'};
    const gate = needsNotion('applied');
    if (gate) return gate;
    try { return await pipeline.addApplied(storage, url, when, log, details || {}); } catch (error) { return {ok: false, text: error.message}; }
  });
  // Settings → Application profile → Standard answers (read from Notion) and the Strategy page's data.
  ipcMain.handle('standardAnswers', async () => {
    try { return {ok: true, groups: questionLists.filterGroups(storage, await questions.standardAnswers(storage))}; } catch (error) { return {ok: false, error: error.message}; }
  });
  // Strategy's one Re-score (pages/strategy-rescore.js): every job scored with previous settings, each once (src/desktop_strategy.py rescore_outdated).
  ipcMain.handle('rescoreOutdated', async () => {
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'rescore-outdated']);
    return code === 0 ? {ok: true, ...JSON.parse(stdout.trim().split('\n').pop())} : {ok: false, error: 'Could not queue them (see the activity log)'};
  });
  // Strategy → "scored with other places" → Refresh: queues the ACTIVE jobs scored with other places (src/ai/locations.py); a change of places never does it alone.
  ipcMain.handle('refreshLocations', async (_, url) => {   // url: one job's drawer; none: every active one (Strategy)
    if (DEMO) return {ok: true, queued: 0};
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'refresh-locations', ...(url ? ['--url', String(url)] : [])]);
    return code === 0 ? {ok: true, ...JSON.parse(stdout.trim().split('\n').pop())} : {ok: false, error: 'Could not queue them (see the activity log)'};
  });
  // "Your search may be too narrow" (src/coverage.py): how much of the market the role keywords catch, and what adding a term would add.
  // The one-tap "why?" after Dismiss and the daily score snapshot (renderer/intel.js): counts for the product, on the Technical reports switch.
  ipcMain.handle('dismissReason', (_, input) => { getRecipeReporter()?.dismissal(String(input?.reason || ''), String(input?.bucket || '')); return {ok: true}; });
  ipcMain.handle('intelSnapshot', (_, list, hosts) => {
    const today = new Date().toISOString().slice(0, 10);
    if (DEMO || storage.settings().intelSnapshotDay === today) return {ok: true, skipped: true};
    // A list without any score or stage (read before Notion's rows came through) is sent, since the site keeps the latest, but does not use up the day.
    const useful = intelLib.informative(list);
    if (useful) storage.saveSettings({intelSnapshotDay: today});
    appLog('intel', `snapshot ${useful ? 'sent' : 'sent, but only unscored/new jobs, so the day stays open'}`, {bands: Array.isArray(list) ? list.length : 0});
    getRecipeReporter()?.snapshot(list);
    getRecipeReporter()?.sources(applicationOutcomes.sourceStats(hosts, controlEvents.boardName));
    return {ok: true};
  });
}

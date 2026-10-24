// Reports → Searches (renderer/pages/reports-searches.js): the search runs from the run history (the store's cron_runs, through the engine), each with the
// details it saved at its end (src/run_details.py). The list leaves out the report and the technical log (large); `reportsSearch` reads one run whole.
// Demo mode: demo/searches.json (fictional). Guarded by test/searches-handlers.test.js.
import fs from 'node:fs';
import * as engine from './store/engine.js';
import {demoPath} from './demo.js';
import {searchRuns} from '../renderer/searches-view.js';

const DAYS = 120;
const slim = ({report, log, ...rest}) => rest;

export async function searches(storage, {call = engine.call, now = Date.now()} = {}) {
  const since = new Date(now - DAYS * 86400000).toISOString();
  return searchRuns((await call(storage, 'cron_runs', 'list', {since})) || []).map(slim);
}

export async function search(storage, id, {call = engine.call} = {}) {
  return (await call(storage, 'cron_runs', 'get', {run_id: String(id || '')})) || null;
}

export function registerSearchesHandlers({ipcMain, storage, DEMO, here, log, call = engine.call}) {
  const demo = () => JSON.parse(fs.readFileSync(demoPath(here, 'searches.json'), 'utf8'));
  ipcMain.handle('reportsSearches', async () => {
    if (DEMO) return {runs: searchRuns(demo()).map(slim)};
    const started = Date.now();
    try {
      const runs = await searches(storage, {call});
      log('reports', 'searches read', {count: runs.length, ms: Date.now() - started});
      return {runs};
    } catch (error) {
      log('reports', 'searches not read', {error: error.message});
      return {error: error.message};
    }
  });
  ipcMain.handle('reportsSearch', async (_, id) => {
    if (DEMO) return {run: demo().find(run => run.id === id) || null};
    try {
      return {run: await search(storage, id, {call})};
    } catch (error) {
      log('reports', 'search not read', {error: error.message});
      return {error: error.message};
    }
  });
}

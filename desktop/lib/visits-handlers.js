// The job-site visits' IPC (moved out of main.js, 8 Oct 2026): opening a site or its tab, visiting again, Read with Claude, hiding and dismissing
// sites, the visit list and a run over it. main.js passes in the services they share. Guards: the visits tests in desktop/test and the
// visits e2e suite.
import * as apply from './apply.js';
import * as claudeSession from './claude-session.js';
import * as pipeline from './pipeline.js';
import * as server from './server.js';
import * as visits from './visits.js';
import fs from 'node:fs';
import {log as appLog} from './log.js';
import {registerRefusedReadsHandlers} from './refused-reads-handlers.js';
import {demoPath} from './demo.js';

export function registerVisitsHandlers(ctx) {
  const {DEMO, allowanceBlock, here, ipcMain, log, readSites, shell, storage} = ctx;
  registerRefusedReadsHandlers({allowanceBlock, log, storage});   // refused sites read in the browser after the person's press: lib/refused-reads.js
  ipcMain.handle('openExternal', (_, url) => shell.openExternal(url));   // opening a job reads nothing in the browser: only the button does (lib/refused-now.js)
  ipcMain.handle('openVisit', (_, url) => visits.openYourself(url));   // the tab you already have for the site, else a new one
  ipcMain.handle('focusBrowser', () => visits.focusBrowser());
  ipcMain.handle('visitShowTab', (_, url) => visits.showTab(url));   // Find jobs using your browser' rows (Recent activity): the tab reading this site
  ipcMain.handle('visitAgain', (_, url) => visits.again(url));        // ... and a site whose tab you closed, back in the run
  // Read with Claude: a Claude in Chrome session reads a site the extension could not (Apply with Claude's needs: Claude Code, its consent).
  ipcMain.handle('visitWithClaude', async (_, url, name) => {
    const ready = apply.claudeReady(storage);
    if (!ready.ok) return ready;
    if (!/^https:\/\//.test(url || '')) return {ok: false, error: 'This site has no address to open.'};
    appLog('visit', 'read with Claude started', {host: new URL(url).hostname, by: 'you'});
    const started = await claudeSession.launchRead(storage, url, String(name || '').slice(0, 80), {claude: apply.claudeBinary()}).catch(error => ({error: error.message}));
    if (started?.id) readSites.set(started.id, [url]);
    return started?.error ? {ok: false, error: started.error} : {ok: true};
  });
  // "Read the failed sites with Claude" (owner, 7 Oct 2026): one session reads them in turn (claude-session.js readManyPrompt).
  ipcMain.handle('visitsWithClaude', async (_, sites = []) => {
    const ready = apply.claudeReady(storage);
    if (!ready.ok) return ready;
    const chosen = (Array.isArray(sites) ? sites : []).filter(site => /^https:\/\//.test(site?.url || '')).slice(0, 10)
      .map(site => ({url: String(site.url), name: String(site.name || '').slice(0, 80)}));
    if (!chosen.length) return {ok: false, error: 'These sites have no address to open.'};
    appLog('visit', 'read with Claude started', {sites: chosen.length, hosts: chosen.map(site => new URL(site.url).hostname).join(' '), by: 'you'});
    const started = await claudeSession.launchRead(storage, chosen[0].url, `${chosen.length} sites`, {claude: apply.claudeBinary(), sites: chosen}).catch(error => ({error: error.message}));
    if (started?.id) readSites.set(started.id, chosen.map(site => site.url));
    return started?.error ? {ok: false, error: started.error} : {ok: true};
  });
  // Remove a site from Find jobs using your browser's list (owner, 7 Oct 2026: "broken, 404: let the user delete/dismiss them"): not offered again.
  ipcMain.handle('visitsHide', async (_, url) => {
    if (!/^https?:\/\//.test(String(url || ''))) return {ok: false};
    appLog('visit', 'site removed from the list by you', {host: new URL(url).hostname});
    const {stdout} = await pipeline.run(storage, ['src.desktop', 'visit-hide', String(url)]).catch(() => ({stdout: ''}));
    try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return {ok: false}; }
  });
  // "Jobs we couldn't read" in the same dialog: open jobs in your places whose posting only your browser can read; Dismiss drops one.
  const demoVisits = () => JSON.parse(fs.readFileSync(demoPath(here, 'visits.json'), 'utf8'));   // demo mode: a few sites and unread jobs to look at
  ipcMain.handle('visitsStuck', async () => ({ok: true, jobs: DEMO ? demoVisits().jobs : await visits.stuckJobs(storage)}));
  ipcMain.handle('visitsDismiss', async (_, url) => {
    if (!/^https?:\/\//.test(String(url || ''))) return {ok: false};
    appLog('visit', 'unread job dismissed by you', {host: new URL(url).hostname});
    const {stdout} = await pipeline.run(storage, ['src.desktop', 'stuck-dismiss', String(url)]).catch(() => ({stdout: ''}));
    try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return {ok: false}; }
  });
  ipcMain.handle('visitsList', async () => {
    if (DEMO) return {ok: true, visits: demoVisits().visits};
    const {stdout} = await pipeline.run(storage, ['src.desktop', 'visit-list']).catch(() => ({stdout: ''}));
    try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return {ok: false, visits: []}; }
  });
  // "Find jobs using your browser" (Actions): a tracked task like Tailor CVs, so the banner, Recent activity and the result card follow it.
  // `board`: "Read this board" (owner, 16 Oct 2026): one address the person typed or picked, opened as a tab the app manages and held for their own Read.
  ipcMain.handle('visitsRun', async (_, {urls = [], postings = [], atOnce = 2, filter = true, board = ''} = {}) => {
    const boardSite = visits.boardSite(board);
    if (board && !boardSite) return {text: 'Paste the board\'s address (it starts with https://).'};
    const {stdout} = await pipeline.run(storage, ['src.desktop', 'visit-list']).catch(() => ({stdout: ''}));
    const listed = (() => { try { return JSON.parse(String(stdout).trim().split('\n').pop()).visits || []; } catch { return []; } })();
    const chosen = boardSite ? [boardSite] : listed.filter(site => urls.includes(site.url));
    const unread = postings.length ? (await visits.stuckJobs(storage)).filter(job => postings.includes(job.url)) : [];
    if (!chosen.length && !unread.length) return {text: 'Tick at least one site or job to read.'};
    const n = Math.max(1, Math.min(5, Number(atOnce) || 2));
    // An older extension in Chrome cannot read the sites by itself (owner's run, 7 Oct 2026: it waited 8 min on 0.9.3): said now, not after.
    const seen = server.extensionSeen?.()?.version, latest = server.latestExtension();
    if (seen && latest && seen !== latest) {
      appLog('visit', 'read sites refused: Chrome has an older extension', {seen, latest});
      return {text: `Chrome still has the Jobadabra extension ${seen}; Find jobs using your browser needs ${latest}. In Chrome open chrome://extensions, press Reload on Jobadabra, then Run again.`};
    }
    appLog('visit', 'read sites task', {sites: chosen.length, postings: unread.length, atOnce: n, filter: !!filter, by: 'you'});
    pipeline.work(storage, 'visits', log, async (tee, signal) => {
      const results = [];
      if (chosen.length) {
        tee(`Reading ${chosen.length} site${chosen.length === 1 ? '' : 's'} in your browser, ${n} at a time`);
        results.push(...await visits.runAll(chosen, boardSite ? {hold: true, tee, waitMs: visits.BOARD_WAIT_MS, signal}   // the board's own address is the page: no job-page search
          : {atOnce: n, filter: !!filter, tee, prepare: async site => (await visits.withJobPages(storage, [site]))[0], signal}));
        if (!signal?.aborted) await visits.remember(storage, results);   // failures remembered: a site failing twice is offered unticked, with why
      }
      // Postings only a browser can read: their text is kept for the job, and the light run below scores them with the sites' matches.
      const read = unread.length && !signal?.aborted ? await visits.readPostings(unread, {tee, signal}) : 0;
      // The matching jobs are scored and written to Jobs before this run ends, in its own turn (owner, 7 Oct 2026: "can't we score them right
      // away?"; a search queued after it waited behind Find new employers): the light run that reads only the pages read in Chrome.
      const fits = (chosen.length ? visits.lastFits() : 0) + read;
      let scored = null;
      if (fits && !allowanceBlock() && !signal?.aborted) {   // stopped: the pages read are kept; the next jobs check scores them
        tee(`Scoring the ${fits} matching job${fits === 1 ? '' : 's'} for your Jobs list…`);
        appLog('visit', 'scoring the jobs read in Chrome inside the read sites run', {fits});
        const {stdout = ''} = await pipeline.run(storage, pipeline.visitsArgs(storage, fits), tee).catch(error => ({stdout: '', error}));
        scored = /Job Matches: (\d+) created/.exec(String(stdout))?.[1] ?? null;
      }
      const text = visits.resultMessage(results, {added: scored === null ? null : Number(scored), postings: unread.length ? {asked: unread.length, read} : null});
      tee(text.split('\n')[1]);
      tee('<<<message'); text.split('\n').forEach(line => tee(line)); tee('message>>>');
      return results.some(result => result.ok) || read > 0;
    }).catch(error => appLog('visit', 'read sites run failed', {error: error.message}));
    return {started: true};
  });   // a site only you can open, in the browser that has the extension
}

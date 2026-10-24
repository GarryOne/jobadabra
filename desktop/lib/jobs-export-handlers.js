// The "Export job list" IPC (Pro): checks the licence in the main process (the window's lock is only a hint), reads the jobs through the store (SQLite or Notion,
// lib/pipeline-commands.js jobs), asks where to save and writes the file. Never touches anything but the file the person picked. Guard: test/jobs-export.test.js.
import fs from 'node:fs';
import path from 'node:path';
import * as pipeline from './pipeline.js';
import {log as appLog} from './log.js';
import {FORMATS, canExport, chosen, fileName, formatOf, render} from './jobs-export.js';

const EVERYTHING = 100000;
export function registerJobsExportHandlers({DEMO, app, dialog, getWindow, ipcMain, licenseState, readJobs = storage => pipeline.jobs(storage, EVERYTHING), storage}) {
  ipcMain.handle('exportJobs', async (_, options = {}) => {
    if (!canExport(licenseState())) return {ok: false, pro: true, error: 'Export is part of Pro.'};
    if (DEMO) return {ok: false, error: 'Demo mode: nothing is saved.'};
    const picked = await dialog.showSaveDialog(getWindow(), {title: 'Export your job list', defaultPath: path.join(app.getPath('documents'), `${fileName()}.csv`),
      filters: [{name: FORMATS.csv, extensions: ['csv']}, {name: FORMATS.json, extensions: ['json']}]});
    if (picked.canceled || !picked.filePath) return {ok: false};
    try {
      const jobs = chosen((await readJobs(storage)).jobs || [], {all: !!options?.all, urls: Array.isArray(options?.urls) ? options.urls : []});
      fs.writeFileSync(picked.filePath, render(jobs, formatOf(picked.filePath)));
      appLog('data', 'job list exported', {jobs: jobs.length, format: formatOf(picked.filePath)});
      return {ok: true, file: picked.filePath, count: jobs.length};
    } catch (error) {
      appLog('data', `job list export failed: ${error.message}`);
      return {ok: false, error: error.message};
    }
  });
}

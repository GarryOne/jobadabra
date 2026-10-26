// The IPC of "Build a CV with the AI" (setup's CV step and Settings → Profile → CV): the draft from the form's answers, saving the edited draft as the
// main CV (with its PDF), and saving that PDF where the person chooses. The AI and the checks are in lib/cv-build.js. Guard: test/cv-build.test.js.
import * as claudeCode from './claude-code.js';
import * as cvlib from './cv.js';
import {buildCv, saveBuilt} from './cv-build.js';
import fs from 'node:fs';
import path from 'node:path';

const fileName = name => `${String(name || 'My').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'My'}_CV.pdf`;

export function registerCvBuildHandlers(ctx) {
  const {dialog, getWindow, ipcMain, printPdf, shell, storage, syncCv} = ctx;
  ipcMain.handle('buildCvDraft', async (_, answers) => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    try { return {ok: true, ...await buildCv(answers, key, ai)}; } catch (error) { return {ok: false, error: error.message}; }
  });
  // The draft as the person edited it: the CV's own page layout draws the PDF, then both become the main CV.
  ipcMain.handle('buildCvSave', async (_, cv) => {
    if (!cv || !Array.isArray(cv.jobs) || !cv.jobs.length) return {ok: false, error: 'There is nothing to save yet.'};
    try {
      const {pdf} = await printPdf(cvlib.writeHtml(storage, cv, 'built.html'));
      const {name} = saveBuilt(storage, cv, pdf, fileName(cv.name));
      syncCv();   // this version to the Profile in Notion too
      return {ok: true, name};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('buildCvDownload', async () => {
    const picked = await dialog.showSaveDialog(getWindow(), {title: 'Save your CV', defaultPath: storage.settings().cvName || 'CV.pdf', filters: [{name: 'PDF', extensions: ['pdf']}]});
    if (picked.canceled || !picked.filePath) return {ok: false};
    fs.copyFileSync(storage.path('cv.pdf'), picked.filePath);
    shell.showItemInFolder(path.resolve(picked.filePath));
    return {ok: true};
  });
}

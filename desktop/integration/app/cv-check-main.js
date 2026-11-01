// Electron main script for cv-check.test.js: prints each CV fixture to a PDF in a hidden window, reads it with the app's own PDF reader and parser, writes the verdicts as JSON.
// Why (R2, 1 Nov 2026): the e2e settings step "the CV check reads real PDFs" needs the main process (BrowserWindow.printToPDF, lib/cv-look.js probeWindow), which the demo window cannot reach;
// this runs the same two calls the cvCheckRun handler makes (lib/cv-handlers.js) in a throwaway Electron with its own user-data folder, never the owner's app.
import {app, BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {FIXTURES} from '../../e2e/lib/cvfixtures.mjs';
import * as cvCheck from '../../lib/cv-check.js';
import * as cvLook from '../../lib/cv-look.js';

const folder = process.env.JOB_PILOTTO_CV_PROBE_DIR;
if (!folder || !process.env.JOB_PILOTTO_CV_PROBE_OUT) throw new Error('JOB_PILOTTO_CV_PROBE_DIR and JOB_PILOTTO_CV_PROBE_OUT are required');
app.setPath('userData', path.join(folder, 'user-data'));
app.dock?.hide();

app.whenReady().then(async () => {
  const out = {};
  const printer = new BrowserWindow({show: false, width: 794, height: 1123});   // one window for every print: a destroyed window made the next load fail (ERR_FAILED, 1 Nov 2026)
  try {
    for (const [name, fixture] of Object.entries(FIXTURES)) {
      await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixture.html)}`);
      const pdf = await printer.webContents.printToPDF({pageSize: 'A4', printBackground: true, preferCSSPageSize: true});
      const file = path.join(folder, `${name}.pdf`);
      fs.writeFileSync(file, pdf);
      const probe = await cvLook.probeWindow(BrowserWindow, file);
      try {
        const result = cvCheck.analyse(await probe.scan());
        out[name] = {score: result.score, checks: Object.fromEntries(result.checks.map(item => [item.id, item.status]))};
      } finally { probe.close(); }
    }
  } catch (error) { out.error = String(error?.stack || error); } finally { printer.destroy(); }
  fs.writeFileSync(process.env.JOB_PILOTTO_CV_PROBE_OUT, JSON.stringify(out));
  app.quit();
});

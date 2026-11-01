// The CV's windows (moved out of main.js, 8 Oct 2026): a tailored CV printed to PDF by Chromium in a hidden window, the probe that keeps the CV PDF's look, and the review window
// with the CV's changes marked. Storage is reached through a getter (it is made after this runs). Guards: the cv, cv-look and tailor tests in desktop/test.
import * as cvLook from './cv-look.js';
import * as cvlib from './cv.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));


export function createCvWindows(ctx) {
  const {BrowserWindow, HIDDEN, clipboard, shell, getStorage} = ctx;
  // A CV page (cv/template.js) printed to PDF by Chromium in a hidden window. Fixed pages (a custom design)
  // never grow, so a page whose content doesn't fit is reported instead of silently cut.
  // The CV PDF's photo, icons, logos and page breaks, cut out of it so the tailored CV looks like it (lib/cv-look.js).
  async function keepLook(cv) {
    const probe = await cvLook.probeWindow(BrowserWindow, getStorage().path('cv.pdf'));
    try { return await cvLook.apply(cvlib.dir(getStorage()), cv, cvLook.plan(await probe.scan(), cv), probe); } finally { probe.close(); }
  }
  // The CV PDF as lib/pdf-edit/read.js sees it, for the in-place tailored CV (lib/cv-inplace-run.js).
  async function readCvPdf(file = getStorage().path('cv.pdf')) {   // a tailored Word CV's drawn PDF is read the same way (lib/cv-docx-tailor.js)
    const probe = await cvLook.probeWindow(BrowserWindow, file);
    try { return await probe.read(); } finally { probe.close(); }
  }
  // Each page of a PDF as a PNG (base64), for the review of an in-place tailored CV.
  async function pageImages(pdfPath, count) {
    const probe = await cvLook.probeWindow(BrowserWindow, pdfPath);
    try { const out = []; for (let n = 1; n <= count; n++) out.push(await probe.page(n)); return out; } finally { probe.close(); }
  }
  // A Word CV drawn by docx-preview and printed to PDF with Word's page size and margins (cv/docx-render.html). faces: lib/docx/fonts.js facesFor.
  async function renderDocx(bytes, faces = []) {
    const win = new BrowserWindow({show: false, width: 900, height: 1200, webPreferences: {sandbox: true, contextIsolation: true}});
    try {
      await win.loadFile(path.join(here, '..', 'cv', 'docx-render.html'));
      for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript('window.cvDocxReady === true')); i++) await new Promise(resolve => setTimeout(resolve, 100));
      const page = await win.webContents.executeJavaScript(`window.cvDocx.render(${JSON.stringify(Buffer.from(bytes).toString('base64'))}, ${JSON.stringify(faces)})`);
      return {pdf: await win.webContents.printToPDF({preferCSSPageSize: true, printBackground: true}), page};
    } finally { win.destroy(); }
  }
  async function printPdf(htmlFile) {
    const printer = new BrowserWindow({show: false, width: 794, height: 1123, webPreferences: {sandbox: true, contextIsolation: true, javascript: true}});
    try {
      await printer.loadFile(htmlFile);
      const overflow = await printer.webContents.executeJavaScript(`document.fonts.ready.then(() =>
        [...document.querySelectorAll('.page.fixed')].map((page, i) => {
          const jobs = [...page.querySelectorAll('.job, .section')], last = jobs[jobs.length - 1];
          const banner = page.querySelector('.banner');
          const limit = (banner || page).getBoundingClientRect()[banner ? 'top' : 'bottom'];
          return last && last.getBoundingClientRect().bottom > limit + 1 ? i + 1 : 0;
        }).filter(Boolean))`);
      const pdf = await printer.webContents.printToPDF({pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: {marginType: 'none'}});
      return {pdf, overflow};
    } finally { printer.destroy(); }
  }

  // The tailored CV's review: the CV with its changes marked, next to what changed and why.
  function openTailoredCv(code) {
    const record = cvlib.load(getStorage(), code);
    if (!record) return false;
    const review = new BrowserWindow({width: 1280, height: 920, title: `Tailored CV · ${record.job.company}`, show: !HIDDEN,
      webPreferences: {sandbox: true, contextIsolation: true}});
    review.webContents.setWindowOpenHandler(({url}) => {
      if (url.startsWith('file:')) shell.openPath(fileURLToPath(url)); else shell.openExternal(url);
      return {action: 'deny'};
    });
    review.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      // The panel's "Final CV" block: Show in Finder and Copy path (the review page has no preload, so they are links).
      if (url.startsWith('jobadabra-cv:')) {
        const final = cvlib.finalCopy(getStorage(), record);
        if (url === 'jobadabra-cv:reveal') shell.showItemInFolder(final); else if (url === 'jobadabra-cv:copy') clipboard.writeText(final);
      } else if (!url.startsWith('file:')) shell.openExternal(url);
    });
    review.loadFile(cvlib.reviewPage(getStorage(), record));
    return true;
  }
  return {keepLook, printPdf, renderDocx, openTailoredCv, readCvPdf, pageImages};
}

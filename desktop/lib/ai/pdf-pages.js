// A PDF as page pictures + its text, for an AI engine that cannot read a PDF file itself (Codex: a live check on 9 Oct 2026 showed it
// answered about a CV without opening the file). Rendered with the pdf.js the app already ships, in a hidden window (cv/pdf-probe.html,
// lib/cv-look.js probeWindow): main.js sets the reader at start-up (codex-cli.js setPdfReader). Nothing leaves this computer here.
// `pageText` is pure and tested in test/ai-contract.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {probeWindow} from '../cv-look.js';
import {AiError} from './contract.js';

export const MAX_PAGES = 6;   // a CV or a letter; a longer PDF sends its first pages as pictures and all its text

// A page's text items (cv/pdf-probe.html scan(): str, x, y, h, top-left points) as lines in reading order.
export function pageText(items = []) {
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) > Math.max(a.h || 0, b.h || 0, 2) / 2 ? a.y - b.y : a.x - b.x));
  const lines = [];
  let last = null;
  for (const item of sorted) {
    if (last && Math.abs(item.y - last.y) <= Math.max(item.h || 0, last.h || 0, 2) / 2) lines[lines.length - 1] += ` ${item.str}`;
    else lines.push(item.str);
    last = item;
  }
  return lines.map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

export const TIMEOUT_MS = 30 * 1000;   // a PDF that cannot be read in this time fails the call, never hangs it
export const TIMEOUT_TEXT = 'Codex: could not read the PDF (it took over 30 s). Try again, or use another AI engine for this step.';

// ([base64 PDF]) -> [{pages: [base64 PNG], text}]: the reader main.js gives the Codex engine. ONE hidden window per call reads every PDF
// of the request (cv-change.js sends two) and is closed once at the end, whatever happened (mac-3f's live check, 9 Oct 2026).
export const electronPdfReader = (BrowserWindow, {maxPages = MAX_PAGES, timeoutMs = TIMEOUT_MS, probe: open = probeWindow} = {}) => async list => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jobadabra-pdf-'));
  let probe = null, timer = null;
  const work = (async () => {
    const out = [];
    for (const [i, base64] of list.entries()) {
      if (i === 0) {
        const file = path.join(folder, 'document.pdf');
        fs.writeFileSync(file, Buffer.from(base64, 'base64'));
        probe = await open(BrowserWindow, file);
      } else await probe.open(base64);
      const scanned = await probe.scan();
      const pages = [];
      for (const page of scanned.slice(0, maxPages)) pages.push(await probe.page(page.n));
      out.push({pages, text: scanned.map(page => pageText(page.text)).join('\n\n')});
    }
    return out;
  })();
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new AiError(TIMEOUT_TEXT)), timeoutMs); });
  try { return await Promise.race([work, late]); }
  finally {
    clearTimeout(timer);
    work.catch(() => {});   // after a timeout the abandoned read may still fail: already reported
    try { probe?.close(); } catch {}
    fs.rmSync(folder, {recursive: true, force: true});
  }
};

// Full-page pictures of the application tab, and one per step (11 Oct 2026, owner: "full page: if there is scrolling, we miss parts of the form"; "one per step").
// fullPageShot photographs the whole page, also when a panel inside the page scrolls and the body does not; a height and byte cap say "cut at <n> px" when hit.
// stepShooter takes one picture each time the tab reaches a new page or step: <dir>/step-01-<kind>.png, step-02-<kind>.png, ... (a per-run cap, then only the end picture).
// Fake applicant only, local, never uploaded; they live in the capture folder, so the privacy tripwire's delete takes them too. Guard: test/step-shots.test.mjs.
/* global document, location, getComputedStyle, window */
import fs from 'node:fs';
import path from 'node:path';

export const MAX_PX = 20000, MAX_BYTES = 8 * 1024 * 1024, MAX_STEPS = 12;
const say = error => String(error?.message || error).replace(/\s+/g, ' ').slice(0, 80);

// In the page: the document's height, the window's size, and how much the tallest scrolling panel hides (a fixed-height body whose form sits in an overflow panel).
const measureInPage = () => {
  const doc = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0), width = window.innerWidth, height = window.innerHeight;
  let hidden = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollHeight <= el.clientHeight + 20 || el.clientHeight < 60) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') hidden = Math.max(hidden, el.scrollHeight - el.clientHeight);
  }
  return {doc, width, height, hidden};
};

// -> {file, why, cut}: cut = the height in px when a cap was hit (0 otherwise; `why` then says "cut at <n> px"). Never throws.
export async function fullPageShot(tab, file, {maxPx = MAX_PX, maxBytes = MAX_BYTES} = {}) {
  if (!tab || !file) return {file: '', why: !tab ? 'no page tab was open' : 'no file given', cut: 0};
  let resized = null;
  try {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const m = await Promise.resolve().then(() => tab.evaluate(measureInPage)).catch(() => null);   // a tab without a page to measure (a fake) gets the plain picture
    let need = m ? Math.max(m.doc, m.height + m.hidden) : 0, cut = 0;
    if (!m || need <= m.height + 1) await tab.screenshot({path: file});
    else {
      if (need > maxPx) { need = maxPx; cut = maxPx; }
      if (m.hidden > Math.max(0, m.doc - m.height)) {   // a panel scrolls inside the page: the window grows to hold it whole, then goes back
        resized = tab.viewportSize() || {width: m.width, height: m.height};
        await tab.setViewportSize({width: resized.width, height: need});
        await tab.waitForTimeout(250);
        await tab.screenshot({path: file});
      } else await tab.screenshot({path: file, fullPage: true, clip: {x: 0, y: 0, width: m.width, height: need}});
    }
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size > maxBytes && !resized) {   // too heavy: keep the top part that fits the byte budget
      cut = Math.max(1000, Math.floor((cut || need) * maxBytes / size * 0.9));
      await tab.screenshot({path: file, fullPage: true, clip: {x: 0, y: 0, width: m.width, height: cut}});
    }
    return fs.existsSync(file) && fs.statSync(file).size > 0 ? {file, why: cut ? `cut at ${cut} px` : '', cut} : {file: '', why: 'the screenshot file is empty', cut: 0};
  } catch (error) { return {file: '', why: `the screenshot failed: ${say(error)}`, cut: 0}; } finally {
    if (resized) await tab.setViewportSize(resized).catch(() => {});
  }
}

// What makes a new step: the address without its fragment and query, the first heading (a multi-step form that keeps its address changes it), and the page kind the run knows.
// Not the controls: a dynamic page (a Workday posting) redraws them all the time and would use up the cap on one page.
const stepSignature = () => {
  const head = [...document.querySelectorAll('h1, [role=heading][aria-level="1"]')].find(el => el.getClientRects().length > 0);
  return JSON.stringify([location.origin + location.pathname, (head?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)]);
};
export const slug = text => String(text || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'page';

// tabOf(): the tab to watch now (or null); kindOf(): the page kind the run knows now ('' when none). prefix 'step' for a live run, 'replay-step' for a replay.
// tick() is called every turn of the watch loop: a new step is shot once its signature has held for two ticks (a page still drawing is not a step). -> {tick, files, notes}
export function stepShooter({tabOf, kindOf = () => '', dir, prefix = 'step', cap = MAX_STEPS, shot = fullPageShot} = {}) {
  const files = [], notes = [];
  let pending = '', shotFor = '';
  return {
    files: () => [...files], notes: () => [...notes],
    async tick() {
      if (!dir || files.length >= cap) return null;
      const tab = tabOf();
      if (!tab) return null;
      const page = await Promise.resolve().then(() => tab.evaluate(stepSignature)).catch(() => '');
      const sig = page && `${page}|${kindOf()}`;
      if (!sig) return null;
      const stable = sig === pending;
      pending = sig;
      if (!stable || sig === shotFor) return null;
      const file = path.join(dir, `${prefix}-${String(files.length + 1).padStart(2, '0')}-${slug(kindOf())}.png`);
      const result = await shot(tab, file);
      shotFor = sig;   // a failed shot is not retried every tick: it is a warning, the end picture is the must
      if (!result.file) { notes.push(`no ${path.basename(file)}: ${result.why}`); return result; }
      files.push(result.file);
      if (result.cut) notes.push(`${path.basename(file)}: ${result.why}`);
      return result;
    },
  };
}

// The app log's newest "page kind: <kind>" (the extension's own line), for naming a step.
export const kindFromLog = log => { const all = [...String(log).matchAll(/page kind: ([a-z][a-z-]*)/g)]; return all.length ? all.at(-1)[1] : ''; };

// The step pictures a folder holds, in order (live: step-NN-*, replay: replay-step-NN-*).
export const stepFilesIn = (dir, prefix = 'step') => { try { return fs.readdirSync(dir).filter(name => new RegExp(`^${prefix}-\\d\\d-.*\\.png$`).test(name)).sort(); } catch { return []; } };

// What a run prints about its step pictures (a missing one is a warning, never an error: the end picture is the must).
export const stepLines = (shooter, dir) => [`live: ${shooter.files().length} step picture(s) kept in ${dir}`, ...shooter.notes().map(note => `live: step picture warning: ${note}`)];

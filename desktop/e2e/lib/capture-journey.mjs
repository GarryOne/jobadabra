/* global document, performance, window */
// Every page a live run saw, each under its own address, for an offline replay of that run (speed-5x landing 1, owner 11 Oct 2026). It owns WHEN a page is
// kept: each frame of each tab (the main document and every iframe: a hosted form is its own page at its own address) is snapshotted the first time its
// shape (ready state, visible controls, text size) held for one turn of the run's watch loop: the page as it arrived. A main page that then changes in place
// and settles again (a dialog a press opened, a banner closed) is kept again as its next state, in order, with its time (speed-5x landing 2: a replay follows
// the live run's states after each press; the extension's own boxes are no change). What is kept of a page is lib/capture-page.mjs snapshotInPage (structure, applied CSS, no script, no value), then the caller's scrub.
// Used by lib/apply-live.mjs (tick() each turn of the watch, finish() and write() at the end). Guard: e2e/test/record/capture-journey.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {snapshotInPage} from './capture-page.mjs';

const MAX_PAGES = 30;
export const addressOf = url => String(url || '').replace(/[?#].*$/, '');
const kept = url => /^https?:\/\//.test(url);

// What makes a page "still arriving": its ready state, how many controls it shows, how much text (in steps of 500 characters).
function shapeInPage() {
  const shown = [...document.querySelectorAll('input, select, textarea, button, a, iframe, dialog')].filter(el => el.getClientRects().length && !el.closest('[id^=jobpilotto], [id^=job-pilotto]')).length;
  return `${document.readyState}|${shown}|${Math.round((document.body?.innerText || '').length / 500)}`;
}

// -> {tick(), finish(), write(dir) -> [{url, file, at, state, frameOf?}]}. scrub: html -> html (the person's values out), applied to every page.
export function journeyRecorder(context, {scrub = html => html} = {}) {
  const list = [], states = new Map(), shapes = new Map(), keptShape = new Map();   // in order; address -> states kept; address -> last shape seen; -> shape at the last kept state
  const frames = () => context.pages().filter(page => kept(page.url())).flatMap(page => page.frames().filter(frame => kept(frame.url())).map(frame => ({frame, page})));
  const snap = async (frame, page, shape, ask = false) => {
    const address = addressOf(frame.url()), state = states.get(address) || 0;
    const html = await frame.evaluate(snapshotInPage).catch(() => '');
    if (!html || list.length >= MAX_PAGES) return;
    const parent = frame === page.mainFrame() ? '' : addressOf(frame.parentFrame()?.url());
    // The window size (a frame's size is in the AI's sketch) and which document this is (its start time): a new state in the same document is a script's change
    // (a single-page app's route, a dialog), a new document a load; the replay plays each back the same way (lib/row-replay.mjs).
    // scrollbar: the width this browser draws a scrollbar (a hidden probe, so a page too short to scroll still tells) (Linux Chrome 15 px, a Mac's overlay 0): a replay on the other system forces it (lib/scrollbar.mjs), else
    // every frame and control sits 15 px elsewhere and the AI's sketch differs (13 Oct 2026, the capture spec's cause 3: a frame 1185 vs 1200 px wide).
    const view = parent ? null : await frame.evaluate(() => ({width: window.innerWidth, height: window.innerHeight, doc: Math.round(performance.timeOrigin), scrollbar: (() => { const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll'; document.documentElement.appendChild(probe); const width = probe.offsetWidth - probe.clientWidth; probe.remove(); return width; })()})).catch(() => null);
    list.push({url: address, html: scrub(html), at: Date.now(), state, ...(ask ? {ask: true, ...(typeof ask === 'string' ? {askRoute: ask} : {})} : {}), ...(view ? {view} : {}), ...(parent ? {frameOf: parent} : {})});
    states.set(address, state + 1); keptShape.set(address, shape);
  };
  return {
    async tick() {
      for (const {frame, page} of frames()) {
        const address = addressOf(frame.url()), shape = await frame.evaluate(shapeInPage).catch(() => null);
        if (!shape) continue;
        const settled = shape === shapes.get(address) && shape.startsWith('complete');
        shapes.set(address, shape);
        if (!settled) continue;
        if (!states.has(address)) await snap(frame, page, shape);
        else if (frame === page.mainFrame() && shape !== keptShape.get(address)) await snap(frame, page, shape);   // the page changed in place and settled again
      }
    },
    // The extension asks what a page is (its page-kind call, seen in the app's ai-calls.json as it is made): that page is kept at once, as the extension saw it,
    // before its fill changes it (11 Oct 2026: a form kept once settled already showed the CV the extension had attached). The replay serves this state first.
    async atAsk(url, route = '/extension/page-kind') { for (const {frame, page} of frames()) if (frame === page.mainFrame() && addressOf(frame.url()) === addressOf(url)) await snap(frame, page, await frame.evaluate(shapeInPage).catch(() => ''), route); },
    // The run ends: a page still arriving at the end is kept as it is now.
    async finish() { for (const {frame, page} of frames()) if (!states.has(addressOf(frame.url()))) await snap(frame, page, await frame.evaluate(shapeInPage).catch(() => '')); },
    write(dir) {
      fs.mkdirSync(path.join(dir, 'pages'), {recursive: true});
      const pages = list.map((item, at) => {
        const file = `pages/${at + 1}.html`;
        fs.writeFileSync(path.join(dir, file), item.html);
        return {url: item.url, file, at: item.at, state: item.state, ...(item.ask ? {ask: true, ...(item.askRoute ? {askRoute: item.askRoute} : {})} : {}), ...(item.view ? {view: item.view} : {}), ...(item.frameOf ? {frameOf: item.frameOf} : {})};
      });
      fs.writeFileSync(path.join(dir, 'journey.json'), `${JSON.stringify(pages, null, 1)}\n`);
      return pages;
    },
  };
}

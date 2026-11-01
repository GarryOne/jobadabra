// The test browser's tabs: a fresh install's settings page is waited for and closed first, then every address the app asks `open` for gets its OWN new tab, and its load is waited for.
// Job: wait on state
// Why (a8, 1 Nov 2026, owner's manifest "Anchor every tab"; beta 41250138244, Windows apply-1of3, Edge, "a Workday-shaped form": "read on about:blank, 1 tab(s)"): the watcher gave the form the
// blank tab it found, the extension's install took a tab for its settings page (background.js onInstalled), and the form's navigation was lost; `goto(...).catch(() => {})` hid the error.
// Hypothesis until the next Windows run shows the trail (lib/tab-trail.mjs). The same install race was named once before on Edge (beta 40281407461); that fix only changed how the test picks the tab.
// Why the blank tab stays (a8, 1 Nov 2026; Gitar on #2754): the owner's 8 Oct 2026 "I want to avoid having 2 tabs all the times" asked for no settings tab beside the test's tab; that settings tab IS closed now. The one blank tab left is the browser's anchor: closing the last tab ends it, and the tab guard closes each step's form tab. Closing the anchor too needs the guard to change: asked of a8.
// Invariants: (1) on a fresh profile nothing is opened before the install's settings page was seen, then it is closed; the browser keeps ONE blank tab (the start tab, or a new one when the settings page
// was the start tab): closing the last tab ends the browser, and the tab guard (lib/tab-guard.mjs) closes every tab a step opened; (2) a spool address never reuses an existing tab;
// (3) a navigation's wait ends with the step's clock (lib/wait-on-state.mjs stepWait); a failed navigation is logged, kept in the trail and thrown by loaded(url) unless the tab shows the address anyway; nothing is retried.
// Tests: test/extension-browser.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import {guardLiveVisit} from './site-ledger.mjs';
import {stepWait} from './wait-on-state.mjs';
import {plain, tabTrail} from './tab-trail.mjs';

// The per-site daily limit is for live visits: a fixture browser's addresses resolve to the fixture server and are never counted
// (12 Oct 2026: local apply runs used up jobs.lever.co's 3 a day and the next run's Lever step was refused). Guard: test/extension-browser.test.mjs, test/site-ledger.test.mjs.
export const visitGuard = real => (real ? (url, options) => guardLiveVisit(url, options) : () => null);

const isSettings = url => /\/options\.html$/.test(String(url));
const live = page => page && !page.isClosed();
const firstLine = error => String(error?.message || error).split('\n')[0].slice(0, 200);

/** Sees the extension's settings page whether the install opens it as a new tab or navigates a tab that already exists to it (Edge may take the blank one). */
export function settingsWatch(context) {
  let seen = null;
  const waiting = new Set();
  const see = page => { if (seen || !isSettings(page.url())) return; seen = page; for (const resolve of waiting) resolve(page); };
  const hook = page => { see(page); page.on('framenavigated', frame => { if (frame === page.mainFrame()) see(page); }); };
  context.pages().forEach(hook);
  context.on('page', hook);
  // Why (a8, 1 Nov 2026): the timer is the hang guard of a state wait (the page's appearance), never a pause; past it the launch fails naming the install page.
  return {wait: guardMs => new Promise((resolve, reject) => {
    if (seen) return resolve(seen);
    const timer = setTimeout(() => { waiting.delete(done); reject(new Error(`the extension's install page (options.html) did not appear within ${guardMs / 1000} s of the browser starting`)); }, guardMs);
    const done = page => { clearTimeout(timer); resolve(page); };
    waiting.add(done);
  })};
}

/** Wait for the install's settings page, then close it; the browser keeps a blank tab (the start tab, or a new one when the settings page was the only tab). */
export async function settleInstall({context, settings, trail, guardMs}) {
  let page;
  try { page = await settings.wait(guardMs); } catch (error) { throw new Error(`${error.message}; tabs: ${trail.summary()}`); }
  if (!context.pages().some(other => live(other) && other !== page)) await context.newPage();
  await page.close();
}

/**
 * Start the tabs of a test browser. `fresh`: a new profile, whose install opens the settings page (kept profiles install nothing). Resolves once that page is dealt with, then watches the spool.
 * @param {{context: object, spool: string, fresh: boolean, real?: boolean, guardMs?: number, pollMs?: number, now?: () => number}} options  pollMs 0: no watching loop, drain() by hand (tests)
 * @returns {Promise<{pages: object, opened: string[], trail: object, drain: () => Promise<void>, loaded: (url: string) => Promise<void>, stop: () => Promise<void>}>}
 */
export async function startTabs({context, spool, fresh, real = false, guardMs = 60000, pollMs = 250, now = Date.now}) {
  const trail = tabTrail(context, {now}), settings = settingsWatch(context);
  if (fresh) await settleInstall({context, settings, trail, guardMs});
  const pages = {}, opened = [], loads = new Map();   // pages: spool address -> its own tab; opened: every address, after its tab exists (a caller that sees the address finds the tab)
  let stopped = false, failure = null;
  const drain = async () => {
    for (const file of fs.readdirSync(spool).filter(name => name.endsWith('.url'))) {
      const url = fs.readFileSync(path.join(spool, file), 'utf8').trim();
      fs.rmSync(path.join(spool, file));
      if (!/^https:\/\//.test(url)) continue;   // the app asked `open` for something else: nothing to do here
      try { visitGuard(real)(url, {who: process.env.JOBADABRA_SESSION || 'browser'}); } catch (error) { console.error(error.message); continue; }   // the per-site daily limit (lib/site-ledger.mjs): a refused address is not opened
      const tab = await context.newPage();
      pages[url] = tab;
      opened.push(url);
      // Why (Gitar on #2754, 1 Nov 2026): the form's load is bounded by the running step's own clock (stepWait: its hang cap, never a zero timeout), not by the launch's 60 s; guardMs is the install page's guard only.
      loads.set(url, stepWait('the form to load', timeout => tab.goto(url, {waitUntil: 'domcontentloaded', timeout})).then(() => null, error => {
        if (!stopped) { trail.failed(tab, url, error); console.error(`the browser could not open ${plain(url)}: ${firstLine(error)}`); }
        return error;
      }));
    }
  };
  // Why (a8, 1 Nov 2026): the spool is a folder, nothing announces a file; the interval is a poll, the wait is for the file.
  const loop = pollMs ? (async () => {
    try { while (!stopped) { await drain(); await new Promise(resolve => setTimeout(resolve, pollMs)); } }
    catch (error) { if (!stopped) { failure = error; console.error(`the spool watcher stopped: ${firstLine(error)}`); } }
  })() : Promise.resolve();
  return {pages, opened, trail, drain,
    async loaded(url) {
      if (failure) throw new Error(`the spool watcher stopped: ${firstLine(failure)}; ${trail.summary()}`);
      const error = await loads.get(url);
      const tab = pages[url];
      if (!error || (live(tab) && tab.url().split('#')[0] === url.split('#')[0])) return;
      throw new Error(`the browser could not open ${plain(url)} in its own tab: ${firstLine(error)}; ${trail.describe(tab)}`);
    },
    stop: async () => { stopped = true; await loop; }};
}

// Picks OUR extension's service worker by its own URL, never by position: the one place the harness finds a worker (a hidden or Playwright browser lists foreign ones too).
// Job: wait on state
/* global chrome */
import fs from 'node:fs';

/** The owned browser's worker, as the product finds it (lib/background-browser.js: a service worker whose URL ends /background-owned.js). */
export const OWNED_WORKER = /^chrome-extension:\/\/[^/]+\/background-owned\.js$/;
/** The extension loaded unpacked into a Playwright browser: the manifest's service worker (extension/manifest.json background.service_worker). */
export const EXTENSION_WORKER = /^chrome-extension:\/\/[^/]+\/background\.js$/;

/** The extension's name in extension/manifest.json: a worker is ours when its own manifest says this. */
const OUR_NAME = JSON.parse(fs.readFileSync(new URL('../../../extension/manifest.json', import.meta.url), 'utf8')).name;

const named = urls => urls.length ? urls.join(' | ') : 'none';

/** From a CDP target list (/json/list): the owned extension's service worker target; throws naming every service worker it saw. */
export function ownedWorkerOf(targets) {
  const workers = targets.filter(target => target.type === 'service_worker');
  const worker = workers.find(target => OWNED_WORKER.test(String(target.url)));
  if (!worker) throw new Error(`no owned service worker (one named background-owned.js) among the service workers seen: ${named(workers.map(target => String(target.url).slice(0, 90)))}`);
  return worker;
}

/**
 * From a Playwright browser context: the extension's service worker, found by what it IS, not where it is listed: a background.js whose own manifest is ours (chrome.runtime.getManifest().name).
 * Why (1 Nov 2026, apply-3of3 41267661024 + Gitar on #2789): the hidden browser listed a Chrome component's thunk.js and ANOTHER extension's background.js before ours, so neither a position nor the file
 * name alone is ours. Waits for the worker's own creation event when it is not listed yet; `timeout` is a hang guard; it throws naming every worker seen and what each one said.
 */
export async function extensionWorker(context, {timeout = 30000} = {}) {
  const seen = new Map();
  return new Promise((resolve, reject) => {
    const checked = new Set();
    let finished = false;
    const finish = (error, worker) => { if (finished) return; finished = true; clearTimeout(timer); context.off('serviceworker', consider); if (error) reject(error); else resolve(worker); };
    const consider = async worker => {
      if (checked.has(worker)) return;
      checked.add(worker);
      const url = worker.url();
      if (!EXTENSION_WORKER.test(url)) { seen.set(url, 'not a background.js'); return; }
      try {
        const name = await worker.evaluate(() => chrome.runtime.getManifest().name);
        seen.set(url, `manifest "${name}"`);
        if (name === OUR_NAME) finish(null, worker);
      } catch (error) { seen.set(url, `unreadable (${String(error?.message || error).slice(0, 80)})`); }
    };
    const timer = setTimeout(() => finish(new Error(`no extension service worker of "${OUR_NAME}" within ${timeout} ms among the service workers seen: ${named([...seen].map(([url, said]) => `${url.slice(0, 90)} ${said}`))}`)), timeout);
    context.on('serviceworker', consider);   // listening first: a worker created between the listing and the wait is not missed
    for (const worker of context.serviceWorkers()) consider(worker);
  });
}

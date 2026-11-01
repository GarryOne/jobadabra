// Picks OUR extension's service worker by its own URL, never by position: the one place the harness finds a worker (a hidden or Playwright browser lists foreign ones too).
// Job: wait on state

/** The owned browser's worker, as the product finds it (lib/background-browser.js: a service worker whose URL ends /background-owned.js). */
export const OWNED_WORKER = /^chrome-extension:\/\/[^/]+\/background-owned\.js$/;
/** The extension loaded unpacked into a Playwright browser: the manifest's service worker (extension/manifest.json background.service_worker). */
export const EXTENSION_WORKER = /^chrome-extension:\/\/[^/]+\/background\.js$/;

const named = urls => urls.length ? urls.join(' | ') : 'none';

/** From a CDP target list (/json/list): the owned extension's service worker target; throws naming every service worker it saw. */
export function ownedWorkerOf(targets) {
  const workers = targets.filter(target => target.type === 'service_worker');
  const worker = workers.find(target => OWNED_WORKER.test(String(target.url)));
  if (!worker) throw new Error(`no owned service worker (one named background-owned.js) among the service workers seen: ${named(workers.map(target => String(target.url).slice(0, 90)))}`);
  return worker;
}

/**
 * From a Playwright browser context: the extension's service worker; waits for its own creation event when it is not listed yet. Why (1 Nov 2026, apply-3of3 41267661024): the first of
 * `context.serviceWorkers()` is not always ours (a Chrome component's thunk.js and another background.js came first). `timeout` is a hang guard; it throws naming every worker seen.
 */
export async function extensionWorker(context, {timeout = 30000, pattern = EXTENSION_WORKER} = {}) {
  const found = () => context.serviceWorkers().find(worker => pattern.test(worker.url()));
  return new Promise((resolve, reject) => {
    const on = worker => { if (pattern.test(worker.url())) { clearTimeout(timer); context.off('serviceworker', on); resolve(worker); } };
    const timer = setTimeout(() => {
      context.off('serviceworker', on);
      reject(new Error(`no extension service worker ${pattern} within ${timeout} ms among the service workers seen: ${named(context.serviceWorkers().map(worker => worker.url().slice(0, 90)))}`));
    }, timeout);
    context.on('serviceworker', on);   // listening first: a worker created between the listing and the wait is not missed
    const now = found();
    if (now) on(now);
  });
}

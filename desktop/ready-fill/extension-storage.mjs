// Writes to a freshly loaded extension's storage through its service worker, after waiting for chrome.storage to exist: a worker evaluated the
// moment it appears has no chrome.storage yet (18 Oct 2026: every Ready to send night failed on it in the Cloudflare container, 3 of 3 locally).
// Used by the night (night.mjs) and the e2e harness (desktop/e2e/lib/real-extension.mjs, pool-eligibility.mjs). Guard: desktop/test/ready-fill.test.js.
export const STORAGE_WAIT_MS = 10000;

// worker: a Playwright Worker (or anything with evaluate(fn, arg)). -> resolves once the values are written; throws when storage never appears.
// The wait runs here, not in the worker: that early, even the worker's own setTimeout can be missing (18 Oct 2026, the image check).
export async function setExtensionStorage(worker, values, waitMs = STORAGE_WAIT_MS) {
  for (const end = Date.now() + waitMs; ;) {
    const ready = await worker.evaluate(() => !!globalThis.chrome?.storage?.local).catch(() => false);
    if (ready) break;
    if (Date.now() >= end) throw new Error(`the extension's storage did not appear within ${waitMs} ms`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await worker.evaluate(values => globalThis.chrome.storage.local.set(values), values);
}

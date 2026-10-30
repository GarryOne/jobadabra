// Waits for any browser's first check-in since the app started (server.extensionHeard), for a "show this form" asked right after a start.
// Pages are tied to their session by the extension's tab report (every 30 s): before the first one, no page can answer, and the show used to
// open a second copy of the form (twin, 9 Oct 2026: asked 6 s before the first check-in, a new tab each time). Guard: test/extension-ready.test.js.
export async function extensionReady(seen, {ms = 35000, step = 500, sleep = wait => new Promise(resolve => setTimeout(resolve, wait))} = {}) {
  if (seen()) return {waited: 0, seen: true};
  let waited = 0;
  while (!seen() && waited < ms) { await sleep(step); waited += step; }
  return {waited, seen: !!seen()};
}

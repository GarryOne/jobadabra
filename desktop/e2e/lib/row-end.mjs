// When a row replay may end (npm run row, the recorded-pages job: each replay used to run to its 90 s cap whenever a model ask missed its kept answer: the extension retried, the request count never stood
// still; 12 Oct 2026): the page and the extension are quiet for STILL ms (lib/live-still.mjs's clock: requests, page log lines, tabs), AND the live run's presses are all made (else the wait is three times as
// long, then the unmade press is the finding), OR a cold ask has waited out 15 s (the case fails on it anyway). Never before the last captured press. -> why it ends, or ''. Guard: e2e/test/row-end.test.mjs.
const COLD_GRACE_MS = 15000, PRESS_GRACE_FACTOR = 3;

// The extension's panel reports the page to the app every 2 s (extension/review.js `setInterval(sync, 2000)`) and the worker reports its tabs: the same body again is a heartbeat, not news
// (a fixture replay made 49 review calls with 4 different bodies and never looked quiet: it ran to its 90 s cap). -> a string that changes only when something new happened.
const HEARTBEAT = new Set(['/extension/review', '/extension/tabs']);
export function activityOf(requests = []) {
  const bodies = new Set();
  let other = 0;
  for (const request of requests) { if (HEARTBEAT.has(request.route)) bodies.add(`${request.route} ${request.body}`); else other++; }
  return `${other}/${bodies.size}`;
}

export function mayEnd({quietMs, stillMs, followed, livePresses, firstMissMs, nowMs}) {
  if (firstMissMs != null && nowMs - firstMissMs >= COLD_GRACE_MS) return 'cold ask';
  if (quietMs < stillMs) return '';
  if (followed >= livePresses) return 'still';
  return quietMs >= stillMs * PRESS_GRACE_FACTOR ? 'still, presses not made' : '';
}

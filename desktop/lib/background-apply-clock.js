// One clock for background Apply's wait; only an isolated e2e app may move it forward.
// Invariants: production always reads wall time; a refused move cannot change the offset.
/** Create the wait clock with injectable wall time/environment for offline tests. */
export function createBackgroundWaitClock({wallNow = Date.now, env = process.env} = {}) {
  let offset = 0;
  const now = () => wallNow() + (env.JOB_PILOTTO_E2E === '1' ? offset : 0);
  return {now, moveTo(at) {
    if (env.JOB_PILOTTO_E2E !== '1') throw new Error('The background wait clock is e2e only');
    const wall = wallNow();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Move the background wait clock forward to a finite timestamp');
    offset = Math.max(offset, at - wall);
    return now();
  }};
}
const clock = createBackgroundWaitClock(), listeners = new Set();
/** Register an app poll only inside e2e; a moved clock wakes the same scheduler even after a restart closed its browser. */
export function onBackgroundWaitMove(poll) {
  if (process.env.JOB_PILOTTO_E2E === '1') listeners.add(poll);
}
/** Read the app's shared wait clock; normal launches always read Date.now(). */
export const backgroundWaitNow = () => clock.now();
/** Move only this isolated e2e app's wait clock to `at`; never exposed through IPC or HTTP. */
export async function moveBackgroundWaitClock(at) {
  const moved = clock.moveTo(at);
  for (const poll of listeners) await poll();
  return moved;
}

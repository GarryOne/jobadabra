// The CI pool's queue (.github/workflows/record-sites.yml, pool-ci-wait.mjs): one recording run at a time, oldest first, none dropped.
// GitHub's concurrency group keeps one pending run and cancels the older (12 Oct 2026: Ocado's dispatch was cancelled by FNAC's of the same second), so each run
// waits here for the earlier ones instead; one at a time also keeps the site-ledger hand-over (lib/pool-ci-state.mjs) free of races. Guard: e2e/test/pool/pool-ci-queue.test.mjs.

// runs: [{databaseId, status}] of every pool workflow; myId: this run. -> the earlier runs not finished yet, oldest first.
export const runsAhead = (runs, myId) => runs.filter(run => Number(run.databaseId) < Number(myId) && run.status !== 'completed')
  .map(run => Number(run.databaseId)).sort((a, b) => a - b);

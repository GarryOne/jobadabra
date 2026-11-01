// Which engine runs (`python -m …`, lib/pipeline-run.js) are still running, so a step that must not move files from under them can wait for exactly those.
// Owns: track() (pipeline-run.js calls it for every run) and settled(). Holds no run back: a run asked for is never delayed.
// Guarded by: test/store-move-late-runs.test.js.
// Why (1 Nov 2026, storemove night red 41253960704): a Focus/Jobs refresh spawned with JOB_PILOTTO_STORE=sqlite during "Move my data to Notion" opened the store after
// the archive renamed it away, and src/stores/sqlite.py connect() made a new empty data/tracker.sqlite beside a Notion store. The move saves store=notion first (every
// run spawned after that gets Notion: pipelineEnv reads the setting at spawn), then waits for the runs that were already running (lib/store-move.js), then archives.
const inFlight = new Set();

/** Remembers one engine run until it settles (success or failure). Returns the same promise. */
export function track(run) {
  inFlight.add(run);
  const done = () => inFlight.delete(run);
  run.then(done, done);
  return run;
}

/**
 * Resolves when every run in flight at this call has ended. Runs asked for later are not waited for (they cannot block it), so a run that starts another while
 * it ends (a stopped run closing its row through a store call) does not deadlock the wait.
 */
export const settled = () => Promise.allSettled([...inFlight]).then(() => {});

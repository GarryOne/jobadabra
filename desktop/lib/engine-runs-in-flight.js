// Which engine runs (`python -m …`, lib/pipeline-run.js) are still running, so a step that must not move files from under them can wait for exactly those.
// Owns: track() (pipeline-run.js calls it for every run) and settled(). Holds no run back: a run asked for is never delayed.
// Guarded by: test/store-move-late-runs.test.js.
// Why (1 Nov 2026, storemove night red 41253960704): a Focus/Jobs refresh spawned with JOBADABRA_STORE=sqlite during "Move my data to Notion" opened the store after
// the archive renamed it away, and src/stores/sqlite.py connect() made a new empty data/tracker.sqlite beside a Notion store. The move saves store=notion first (every
// run spawned after that gets Notion: pipelineEnv reads the setting at spawn), then waits for the runs that were already running (lib/store-move.js), then archives.
const inFlight = new Map();   // run → bounded

/**
 * Remembers one engine run until it settles (success or failure). Returns the same promise. `bounded`: the engine's watchdog ends it (lib/pipeline-run.js isWatched); a
 * run that waits on a person or a download (a Google sign-in, a transcription, pip) is not, and no step may wait for it.
 */
export function track(run, {bounded = true} = {}) {
  inFlight.set(run, bounded);
  const done = () => inFlight.delete(run);
  run.then(done, done);
  return run;
}

/**
 * Resolves when every bounded run in flight at this call has ended. Runs asked for later are not waited for (they cannot block it), so a run that starts another while
 * it ends (a stopped run closing its row through a store call) does not deadlock the wait. Unbounded runs are skipped: none of them opens the store, and a sign-in
 * left waiting on a person would hold the move for ever (Gitar on #2756).
 */
export const settled = () => Promise.allSettled([...inFlight].filter(([, bounded]) => bounded).map(([run]) => run)).then(() => {});

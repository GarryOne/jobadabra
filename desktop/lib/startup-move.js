// The app's start-up move of data into the store (lib/background-handlers.js runs migrate.run once per start): it drops this Mac's profile.md and answers.md once the store has them.
// One promise owned here so whatever packs the data folder (Export, the automatic backup: lib/reset.js exportTo) waits for the move instead of racing it. No imports: any module may use it.
let current = Promise.resolve();

/**
 * Remember the start-up move's promise; returns it unchanged. `onEnd({moved, error?})` runs once when the move is over, on success AND on failure (the app logs
 * "startup moves finished" from it: the settings e2e waits on that line, so a move that throws must end it too, Gitar on #2347). A failed move still counts as over.
 */
export function track(promise, onEnd = () => {}) {
  current = Promise.resolve(promise).then(moved => onEnd({moved: Array.isArray(moved) ? moved.length : 0}), error => onEnd({moved: 0, error: String(error?.message || error)}));
  return promise;
}

/** Resolves when the start-up move is over and its end was reported (at once when none started or it ended). */
export const settled = () => current;

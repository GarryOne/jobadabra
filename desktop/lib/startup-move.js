// The app's start-up move of data into the store (lib/background-handlers.js runs migrate.run once per start): it drops this Mac's profile.md and answers.md once the store has them.
// One promise owned here so whatever packs the data folder (Export, the automatic backup: lib/reset.js exportTo) waits for the move instead of racing it. No imports: any module may use it.
let current = Promise.resolve();

/** Remember the start-up move's promise; returns it unchanged. A failed move still counts as over. */
export function track(promise) { current = Promise.resolve(promise).catch(() => {}); return promise; }

/** Resolves when the start-up move is over (at once when none started or it ended). */
export const settled = () => current;

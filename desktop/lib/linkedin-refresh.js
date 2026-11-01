// LinkedIn jobs, refresh at each Find jobs (issue #2731; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md, Behaviour 1: the extension copies the session "when the switch is turned
// on and at each Find jobs while on"). The app cannot call the extension; the extension looks at the app once a minute (/extension/linkedin-pending). So a person's Find jobs press opens a
// "refresh wanted" note, the extension's next look sees it, copies the two cookies again and posts them (/extension/linkedin-refresh), and the LinkedIn step reads the Keychain only after that.
// Same shape as the refused-sites press (lib/refused-now.js: the press waits for the extension's look). Nothing here holds or logs a cookie. Guard: test/linkedin-refresh.test.js.
export const WAIT_MS = 70000;    // one look every 60 s, plus the copy itself: the longest a press waits for the extension
export const ALIVE_MS = 150000;  // a look younger than this = the extension is running with the LinkedIn grants; older = Chrome is closed, nothing to wait for

/** One owner of "is a refresh wanted, did it arrive". `now`/`later` are injectable so a test never waits for a real clock. */
export function createRefresh({now = Date.now, later = (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); }} = {}) {
  let lookAt = 0, wanted = false;
  const waiters = new Set();
  const settle = outcome => { wanted = false; for (const done of [...waiters]) done(outcome); };
  return {
    /** The extension's one-minute look arrived: remember it, and say whether a copy is wanted now. */
    look() { lookAt = now(); return wanted; },
    /** The extension answered (a fresh copy was saved, or it had nothing to send): the waiting press goes on. */
    delivered() { settle('fresh'); },
    /**
     * A person's Find jobs press: ask the extension for a fresh copy and wait for it. -> 'fresh' | 'late' (no answer in time: the held copy is used) | 'no-extension' (no look lately: nothing to wait
     * for) | 'stopped'. Why: the held copy is only a fallback, so a closed Chrome never delays or fails a press.
     */
    async ask({signal = null, say = () => {}, timeoutMs = WAIT_MS} = {}) {
      if (signal?.aborted) return 'stopped';
      if (now() - lookAt > ALIVE_MS) return 'no-extension';
      wanted = true;
      say('LinkedIn: copying your sign-in from Chrome again');
      let cancel = () => {}, onAbort = null;
      const outcome = await new Promise(resolve => {
        const done = value => { waiters.delete(done); cancel(); if (onAbort) signal.removeEventListener('abort', onAbort); resolve(value); };
        waiters.add(done);
        cancel = later(() => done('late'), timeoutMs);
        if (signal) { onAbort = () => done('stopped'); signal.addEventListener('abort', onAbort, {once: true}); }
      });
      wanted = false;
      return outcome;
    },
  };
}

/** The app's one refresh note, shared by the routes (lib/linkedin-handlers.js) and the step's seams (lib/linkedin-beside.js). */
export const refresh = createRefresh();

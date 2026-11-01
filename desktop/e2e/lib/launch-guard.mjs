// One browser that did not start stops the whole run: every later start in the same process fails at once with the first reason, never waits again.
// Why: on 13 Oct 2026 a local run of the 93 recorded cases waited 180 s for a browser that never started, once per case and again per case "alone": hours, no case ran.
// Used by lib/real-extension.mjs (the one place every runner starts the real extension: recorded pages, row cases, replay-records). Guard: e2e/test/harness/launch-guard.test.mjs.
export const LAUNCH_TIMEOUT_MS = 60000;   // a start takes seconds; a loaded Mac needs more, never three minutes

export function makeLaunchGuard() {
  let first = null;
  return {
    check() {
      if (first) throw new Error(`the browser did not start earlier in this run (${first}): the machine or the browser install is broken, not this case; stopped without starting it again`);
    },
    failed(error) { first ||= String(error?.message || error).split('\n')[0].slice(0, 160); },
    reason: () => first,
  };
}

export const launchGuard = makeLaunchGuard();

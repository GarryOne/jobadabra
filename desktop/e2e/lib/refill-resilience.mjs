// Two small guards for the replay refill (16 Oct 2026, run 38819507828): a GitHub upload that fails once is tried again, and a row whose fill asked nothing has nothing to refill. Pure.
// Guard: e2e/test/filling/refill-resilience.test.mjs.

// Run `action` up to `tries` times; `wait(ms)` between tries (default a real pause). Throws the last error.
export function withRetry(action, {tries = 3, delayMs = 4000, wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)} = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return action(); } catch (error) { if (attempt >= tries) throw error; wait(delayMs * attempt); }
  }
}

// fill-memo's log: "<row> check (no model): 0/0 live asks answered": the row stopped before any question (a posting with no form), so no model-memo.json exists and none is needed.
export const nothingToRefill = log => /fill-memo: .*: 0\/0 live asks answered/.test(String(log));

// A bundle's two release files, the bundle first and its key last (net-records-fetch.sh opens a bundle by finding its key, so a key without its bundle fails the decrypt; 15 Oct 2026 group 3: the key
// reached the release, the bundle got HTTP 404, and every fetch after printed an openssl "No such file" for it). Each file is tried again on its own; a bundle that never uploads leaves no key.
export function uploadBundle(upload, bundle, key, retry = withRetry) {
  retry(() => upload(bundle));
  retry(() => upload(key));
}

// The site replay that follows a publish is started with the RUN's token (DISPATCH_TOKEN), not the one that writes the private records repo (that token has no rights on this repo:
// HTTP 403 on every dispatch, 16 Oct 2026). -> {env, repoArgs} for `gh workflow run`; without DISPATCH_TOKEN the env is unchanged (a Mac run uses the person's own login).
export function dispatchGh(env = process.env) {
  if (!env.DISPATCH_TOKEN) return {env, repoArgs: []};
  return {env: {...env, GH_TOKEN: env.DISPATCH_TOKEN}, repoArgs: env.GITHUB_REPOSITORY ? ['-R', env.GITHUB_REPOSITORY] : []};
}

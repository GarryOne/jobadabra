// Whether run-all.mjs may run on this Mac (owner, 11 Oct 2026, "CI heavy, local light"; docs/rules/change-loop.md rule 7): CI runs the e2e suites on every PR, so a local run is the
// step you are debugging or adding (E2E_STEPS=...), the owner's live run (LIVE=1, npm run live), or a full run by the owner's choice (JP_E2E_FULL=1). 12 Oct 2026: a session ran two
// whole suites under the heavy lock while two sessions queued proofs behind it, because rule 7 still said "run the suites locally". Guard: e2e/test/local-run.test.mjs.

// env -> '' when the run may go on, else why not (one paragraph for the terminal).
export function localRunRefused(env = process.env) {
  if (env.CI || env.GITHUB_ACTIONS) return '';
  if (String(env.E2E_STEPS || '').trim() || String(env.E2E_STEP_NAMES || '').trim() || env.LIVE === '1' || env.JP_E2E_FULL === '1') return '';
  return 'no whole e2e suite on this Mac: CI runs the suites on your PR (tools/ship.sh opens it; docs/rules/change-loop.md rule 7).\n'
    + "Locally only the step you are debugging or adding: E2E_STEPS='<step>,<prerequisites>' node run-all.mjs --only <suite>. A full run by the owner's choice: JP_E2E_FULL=1.";
}

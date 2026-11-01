// A picked step renamed since the coverage map is no red: the suite's only try then runs the whole suite once (a stale pick ran nothing).
// Job: pick the suites
// Usage (e2e.yml, e2e-windows.yml): node red-steps.mjs --renamed-only <suite-failures.json>   exit 0 when the only red is a picked name that matched no step.
// E2E_FALLBACK_SUITES reserves the first three distinct picked suites; E2E_FALLBACK_SUITE identifies this leg. The CLI exits 2 beyond that cap.
// There is no retry of red steps any more (31 Oct 2026, owner: "And why should we accept/allow that?"). Guard: test/red-steps.test.mjs, tests/test_renamed_pick_fallback.py.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

// The runner's own record when a picked name matched no step (renamed): only the whole suite can tell what that step was.
const NOT_A_STEP = 'steps picked for this PR';
// Why (29 Oct 2026, a8, #2484): nineteen stale picks launched whole suites together; reserve only three fallback suites per run.
const MAX_RENAMED_FALLBACK_SUITES = 3;

// A picked run whose only red is the runner's own "no step is named ..." (a step renamed since the coverage map): nothing failed, the pick was stale. The first try
// then runs the whole suite at once instead of going red (27 Oct 2026: 19 of 54 reds on 26-27 Oct were this, each a red, a retry and a false "PR e2e is noisy").
export const onlyRenamedPicks = records => Array.isArray(records) && records.length > 0 && records.every(item => item?.step === NOT_A_STEP);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[3];
  let records = null;
  try { records = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { records = null; }
  // Every matrix leg sees the same ordered plan: deterministic reservations need no cross-runner counter or network.
  if (onlyRenamedPicks(records) && process.env.E2E_FALLBACK_SUITES !== undefined) {
    const eligible = [...new Set(process.env.E2E_FALLBACK_SUITES.split(',').filter(Boolean))].slice(0, MAX_RENAMED_FALLBACK_SUITES);
    if (!eligible.includes(process.env.E2E_FALLBACK_SUITE)) {
      const reason = 'picked step not found (fallback limit)';
      fs.writeFileSync(file, JSON.stringify(records.map(record => ({...record, message: reason})), null, 2));
      console.error(`::error::${reason}`);
      process.exit(2);
    }
  }
  process.exit(process.argv[2] === '--renamed-only' && onlyRenamedPicks(records) ? 0 : 1);
}

// The steps a red first try failed, for its retry: the retry repeats only those and their setup (owner, 27 Oct 2026: "Retry only the red steps").
// Usage (e2e.yml, desktop.yml): node red-steps.mjs <first try's suite-failures.json> -> a JSON list for E2E_STEP_NAMES, or nothing (run the whole suite).
//   node red-steps.mjs --renamed-only <suite-failures.json>   exit 0 when the only red is a picked name that matched no step (e2e.yml, e2e-windows.yml: run whole now).
// The runner adds each picked step's setup (lib/runner.mjs pickedNames, stepNeeds). Guard: test/red-steps.test.mjs, tests/test_retry_red_steps.py.
import fs from 'node:fs';
import path from 'node:path';

// The runner's own record when a picked name matched no step (renamed): only the whole suite can tell what that step was.
const NOT_A_STEP = 'steps picked for this PR';

// suite-failures.json's records -> the red steps' names (once each, in order), or null: no step to name, so the whole suite runs again.
export function redSteps(records) {
  const names = [...new Set((Array.isArray(records) ? records : []).map(item => item?.step).filter(Boolean))];
  if (!names.length || names.includes(NOT_A_STEP)) return null;
  return names;
}

// A picked run whose only red is the runner's own "no step is named ..." (a step renamed since the coverage map): nothing failed, the pick was stale. The first try
// then runs the whole suite at once instead of going red (27 Oct 2026: 19 of 54 reds on 26-27 Oct were this, each a red, a retry and a false "PR e2e is noisy").
export const onlyRenamedPicks = records => Array.isArray(records) && records.length > 0 && records.every(item => item?.step === NOT_A_STEP);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const renamedOnly = process.argv[2] === '--renamed-only', file = process.argv[renamedOnly ? 3 : 2];
  let records = null;
  try { records = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { records = null; }
  if (renamedOnly) process.exit(onlyRenamedPicks(records) ? 0 : 1);
  const names = redSteps(records);
  if (names) process.stdout.write(JSON.stringify(names));
}

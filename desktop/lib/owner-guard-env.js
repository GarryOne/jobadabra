// The test harness's list of the owner's own values, as the app under test receives it (owner, 14 Oct 2026: an answer that is the owner's value is never typed, see
// app-core/src/owner-guard.js). Honoured ONLY under the e2e harness (JOB_PILOTTO_E2E) and only when the harness handed a list (JOB_PILOTTO_E2E_OWNER_VALUES, a JSON
// array of [value, kind]); the variable is removed from this process at once, so no child process (claude -p, a terminal) can read it. A user's app has neither
// variable: no code path, and its own fills use its own identity on purpose. Guard: desktop/test/owner-guard-wiring.test.js.
import {parseOwnerValues} from '../shared/app-core/owner-guard.js';

export function takeOwnerValues(env = process.env) {
  const raw = env.JOB_PILOTTO_E2E_OWNER_VALUES;
  delete env.JOB_PILOTTO_E2E_OWNER_VALUES;
  return env.JOB_PILOTTO_E2E && raw ? parseOwnerValues(raw) : null;
}

export const OWNER_VALUES = takeOwnerValues();

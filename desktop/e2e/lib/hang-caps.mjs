// Loads measured state-wait caps and resolves exact shared-step measurements.
// Job: wait on state
import {readFileSync} from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../hang-caps.json', import.meta.url), 'utf8'));
const tables = new Map();
const lanes = JSON.parse(readFileSync(new URL('../lanes.json', import.meta.url), 'utf8')).suites;

/**
 * A backbone suite has no lane in lanes.json and a cadence a gate can run: its steps need a named cap.
 * Why (31 Oct 2026, owner, a8 2/5): run 41200878403's read step had no cap and stalled 6.6 min under the 8-minute default. A suite with a manual cadence
 * (explore) is never chosen by a schedule or a push (lib/plan.mjs autoSuites), so it keeps the default; the caller passes the suite's own cadence export.
 * Isolated runner tests without a suite name keep their explicit options.
 */
export const backboneSuite = (suite, cadence = '') => !!suite && !lanes[suite]?.lane && cadence !== 'manual';

/** Return one suite's cap table in seconds, or quality's recording allowances; shared steps keep their exact source. */
export function hangCapsFor(suite, {record = false} = {}) {
  // Invariant: a shared relation names this exact step in its measured source suite.
  const key = `${suite}:${record}`;
  if (!tables.has(key)) tables.set(key, Object.fromEntries(Object.entries(data[suite]?.steps || {})
    .map(([name, step]) => [name, record && step.recordSeconds !== undefined ? step.recordSeconds : step.shared ? hangCapsFor(step.shared)[name] : step.seconds])));
  return tables.get(key);
}

// Loads measured state-wait caps and resolves exact shared-step measurements.
// Job: wait on state
import {readFileSync} from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../hang-caps.json', import.meta.url), 'utf8'));
const tables = new Map();

/** Return one suite's cap table in seconds; shared steps retain their source suite's measured cap. */
export function hangCapsFor(suite) {
  // Invariant: a shared relation names this exact step in its measured source suite.
  if (!tables.has(suite)) tables.set(suite, Object.fromEntries(Object.entries(data[suite].steps)
    .map(([name, step]) => [name, step.shared ? hangCapsFor(step.shared)[name] : step.seconds])));
  return tables.get(suite);
}

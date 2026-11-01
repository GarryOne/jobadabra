// The steps of a suite that the lane registry suspends (desktop/e2e/lanes.json, top-level `steps`): {<suite>: {<exact step name>: {lane: 'suspended', issue, since, why, returns, ...}}}.
// A suspended step still runs and shows its result (steps.json status `suspended`), but never fails the job and never blocks a beta (lib/runner.mjs); the owner issue holds the evidence.
// Why (31 Oct 2026, owner: "Means its flaky, Means our redesign and guardarails are not fully working"; spec row 33): a step red on unchanged code is suspended by name, not its whole suite.
// Invariants: the registry is edited by a PR only (tools/suspend-flip.mjs proposes, never writes); matching is by exact step name.
// Tests: test/suspended-steps.test.mjs
// Job: report health
import fs from 'node:fs';

const readLanes = () => JSON.parse(fs.readFileSync(new URL('../lanes.json', import.meta.url), 'utf8'));

/** @returns {Record<string, object>} the suspended steps of one suite on this platform, by exact step name. An entry with a `platforms` list (process.platform
 * values) holds only there; without one it holds everywhere. A missing or malformed registry suspends nothing.
 * Why (#2719, 31 Oct 2026): a flake seen only on Windows must not stop the same step from protecting the journey on Mac and Linux. */
export function suspendedStepsOf(suite, lanes, platform = process.platform) {
  try {
    const entries = (lanes || readLanes()).steps?.[suite] || {};
    return Object.fromEntries(Object.entries(entries).filter(([, entry]) => entry?.lane === 'suspended'
      && (!Array.isArray(entry.platforms) || entry.platforms.includes(platform))));
  } catch { return {}; }
}

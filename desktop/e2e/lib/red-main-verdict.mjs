// The one decision "does a red on main stop a beta?": only a failed step marked safety or data does; any other red goes on and is listed. Pure: the caller reads the steps.json tables.
// Why (1 Nov 2026, owner: "Safety strict, rest tolerant", then a8's option "Same rule as the beta"): the nightly (run 41267448030) built nothing over one flaky sign-up step (applyflows, run 41267492981).
// Both callers use this: tools/red-main-gate.sh (the nightly's gate G2 and tools/beta-release.sh) through tools/red-main-verdict.mjs. A missing or unreadable result is never a pass.
// Tests: test/red-main-verdict.test.mjs, tests/test_red_main_gate.py
// Job: report health

/** The line the beta carries to its release notes (beside "Passed on retry in this beta"), or '' when nothing was red but tolerated. */
export const notBlockingLine = items => (items.length ? `Red on main, not safety or data: ${items.join(', ')}` : '');

/**
 * found: [{suite, runId, tables: [{name, table}] | undefined, error?}] — one per red suite, `tables` the steps.json of each of its artifacts (every shard and store leg).
 * -> {block, reasons: [why it blocks], notBlocking: ['suite · step', …], line}
 */
export function judgeReds(found) {
  const reasons = [], tolerated = new Set();
  for (const {suite, runId, tables, error, noFailedJob} of found) {
    const where = `${suite} (run ${runId})`;
    if (noFailedJob) { reasons.push(`${where}: the run is red but none of these suites has a failed job`); continue; }
    if (error) { reasons.push(`${where}: its results could not be read (${error})`); continue; }
    if (!tables?.length) { reasons.push(`${where}: its results could not be read (no steps.json among the run's artifacts)`); continue; }
    const broken = tables.filter(item => !Array.isArray(item.table?.results));
    if (broken.length) { reasons.push(`${where}: its results could not be read (${broken.map(item => item.name).join(', ')} has no readable steps.json)`); continue; }
    const failed = tables.flatMap(item => item.table.results.filter(result => result.status === 'failed'));
    if (!failed.length) { reasons.push(`${where}: red, but no failed step is recorded (the suite broke outside its steps)`); continue; }
    for (const result of failed) {
      const name = `${suite} · ${result.name}`;
      if (result.safety) reasons.push(`${name}: a safety step failed`);
      else if (result.data) reasons.push(`${name}: a data step failed`);
      else if (result.budget) reasons.push(`${name}: not run, the suite was over its budget (a step that never ran proves nothing)`);   // Why: runner.mjs does not stamp safety on a budget skip, so a safety step cut by the budget would read as tolerable
      else tolerated.add(name);
    }
  }
  const notBlocking = [...tolerated];
  return {block: reasons.length > 0, reasons, notBlocking, line: notBlockingLine(notBlocking)};
}

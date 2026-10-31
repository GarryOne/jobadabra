// Job: report health
// One row per step run, built from a steps.json: the records the beta gate counts (a step is proven by its runs on unchanged code), the night burn-in's passes included.
// Why (31 Oct 2026, a8 with slot 1, the gate): a burn-in pass is an ordinary e2e run, so there is ONE row builder for every kind of run (night, PR, after-merge, beta, main check); the
// gate's job reads rows, never the artifacts of a run twice. The first try is the verdict (#2682): a step that passed only on the environment's once-more try is `attempt: 2`, so it cannot hide a red.
// Invariants: pure (no reads); a step that did not run (skipped, over its suite's budget, AI capped) has no row; the row names the suite and step exactly as steps.json does; all rows are kept at write
// time (changed-code PR runs included) and the reader filters, because a record that dropped rows cannot be re-judged. "Unchanged code" is not decided here (the reader holds the coverage map).
// Tests: test/step-rows.test.mjs
import {NIGHT_TITLE} from './night-pass.mjs';

const MACHINES = {darwin: 'mac', linux: 'linux', win32: 'windows'};

/** The kind of run a title names: night | pr | after-merge | beta | other (a main check, a run by hand); mutant, soak, canary and bisect runs test other code and give no rows. */
export function kindOfTitle(title) {
  const text = String(title || '');
  if (text.startsWith(NIGHT_TITLE)) return 'night';
  if (/^E2E for PR ·/.test(text)) return 'pr';
  if (/^E2E after merge ·/.test(text)) return 'after-merge';
  if (/^(Beta E2E tests|Gate) /.test(text)) return 'beta';
  if (/^(Mutant|RC soak|Stable canary|Bisect|E2E check · outside world) /.test(text)) return 'not-main';
  return 'other';
}

const storeOf = (table, key) => table.store || /-(standin|sqlite)$/.exec(key)?.[1] || '';
const machineOf = (table, key) => MACHINES[table.os] || (key.startsWith('windows-') ? 'windows' : '');

/**
 * The rows of one steps.json. key: the artifact's key without "e2e-view-" (suite, shard, store leg, "windows-" lane); run: {id, sha, at, title}.
 * @returns {{step: string, suite: string, name: string, ok: boolean, attempt: 1|2, store: string, machine: string, key: string, sha: string, runId: string, kind: string, at: string, safety?: true, suspended?: true, environment?: true}[]}
 */
export function stepRows(table, {key, run}) {
  const kind = kindOfTitle(run.title);
  if (kind === 'not-main' || !Array.isArray(table?.results)) return [];
  const suite = table.suite || '';
  const common = {suite, store: storeOf(table, key), machine: machineOf(table, key), key, sha: run.sha, runId: String(run.id), kind, at: run.at};
  return table.results.flatMap(result => {
    const ran = result.status === 'passed' || result.status === 'suspended' || (result.status === 'failed' && !result.budget);
    if (!ran) return [];
    return [{step: `${suite}/${result.name}`, name: result.name, ok: result.status === 'passed', attempt: result.retried ? 2 : 1, ...common,
      ...(result.safety ? {safety: true} : {}), ...(result.suspended || result.status === 'suspended' ? {suspended: true} : {}), ...(result.environment ? {environment: true} : {})}];
  });
}

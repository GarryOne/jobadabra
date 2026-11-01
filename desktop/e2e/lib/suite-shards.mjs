// A suite too long for one CI job says `export const shards = n` (the recorded replay): every gate lane runs it as n jobs, `JP_REPLAY_SHARD=i/n` each (lib/replay-shard.mjs
// cuts the cases, as page-cases.yml does for the PR check). The matrix entries (plan-run.mjs, plan-windows.mjs) and the way back from a job's key to its suite live here.
// Job: pick the suites
// Guard: test/harness/suite-shards.test.mjs (every slice fits its budget at today's case count; every workflow that runs a suite passes the shard and names its job by key).

import {tolerantMatrixFlag} from './plan.mjs';

export const shardKey = (suite, index, count) => `${suite}-${index}of${count}`;

// -> [{key, shard}]: one per slice, or the suite itself (shard '': the whole suite).
export const shardLegs = (suite, count = 1) => (count > 1
  ? Array.from({length: count}, (_, at) => ({key: shardKey(suite, at + 1, count), shard: `${at + 1}/${count}`}))
  : [{key: suite, shard: ''}]);

/** Resolve a job key or workflow label to its suite, removing the prefix, burn-in attempt, store leg and shard in that order. */
export const suiteOfKey = key => String(key || '').replace(/^E2E · (?:Mac \+ Linux · )?/, '').replace(/ · burn-in \d+\/\d+$/, '')
  .replace(/-(standin|sqlite)$/, '').replace(/-\d+of\d+$/, '');

/** Lanes excluded from backbone gating and owner health alerts. */
export const NON_BACKBONE = ['tolerant', 'suspended', 'retired'];

/** Check a canonical suite's lane; an unlisted suite remains backbone so new suites and planning failures still block. */
export const isBackbone = (lanes, suite) => !NON_BACKBONE.includes(lanes?.suites?.[suite]?.lane);

// The Windows lanes' matrix (e2e-windows.yml, desktop.yml test-windows): one entry per suite, or per slice of a sharded one.
export const windowsMatrix = (suites, shards = {}) => ({include: suites.flatMap(suite => shardLegs(suite, shards[suite]).map(leg => ({suite, ...tolerantMatrixFlag(suite), ...leg})))});

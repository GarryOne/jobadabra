// Splits the recorded cases across the CI matrix's jobs (.github/workflows/page-cases.yml): JP_REPLAY_SHARD="i/n" runs the i-th of n slices.
// Job: pick the suites
// Balanced by measured slow first-try CI seconds (fixtures/slice-ci-seconds.json, 24–31 Oct 2026 main/beta artifacts), else its declared window
// (a case with only "must not happen" checks waits its whole window); every case in exactly one slice. Guard: e2e/test/replay/replay-shard.test.mjs.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const POSITIVE = ['told', 'filled', 'attached', 'judged', 'asked', 'pressed', 'gone'];
export const caseCost = item => (POSITIVE.some(kind => (item.expect?.[kind] || []).length) ? 0.3 : 1) * (item.expect?.seconds || 40);   // a case with a positive check usually ends early

export const SECONDS_FILE = fileURLToPath(new URL('../fixtures/slice-ci-seconds.json', import.meta.url));
export const MISSING_SECONDS = 25;   // a case the measured run lacks (it was re-run alone, so its seconds were not kept): about what a typical case costs on a PR
/** Read CI shard weights; explicit legacy timing files with a seconds map remain supported. */
export const readSeconds = (file = SECONDS_FILE) => { try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data.recorded || data.seconds || {}; } catch { return {}; } };
export const costOf = (item, seconds = {}) => (Object.keys(seconds).length ? seconds[item.name] ?? MISSING_SECONDS : caseCost(item));

// "2/4" -> {index: 2, count: 4}; "" -> null (the whole set); anything else throws.
export function parseShard(spec) {
  if (!spec) return null;
  const match = /^(\d+)\/(\d+)$/.exec(String(spec));
  const index = match ? Number(match[1]) : 0, count = match ? Number(match[2]) : 0;
  if (!match || count < 1 || index < 1 || index > count) throw new Error(`replay shard "${spec}": expected i/n with 1 <= i <= n`);
  return {index, count};
}

// A suite that runs steps, not cases (applyflows): the n-th step (0-based, in the order the suite meets them) belongs to slice `index` of `count` when this is true. Round-robin: every
// step is in exactly one slice, and the costs alternate (test/harness/suite-shards.test.mjs).
export const shardTurn = (ordinal, shard) => !shard || ordinal % shard.count === shard.index - 1;

/** Assign measured steps or cases to slices: costliest first into the lightest slice; each name has exactly one owner. */
export function weighedSlices(seconds, count) {
  const load = Array(count).fill(0), owner = {};
  for (const [head, cost] of Object.entries(seconds).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const lightest = load.indexOf(Math.min(...load));
    owner[head] = lightest + 1; load[lightest] += cost;
  }
  return owner;
}

/** Return one recorded-case slice using the same measured greedy cut as apply/applyflows; preserve cost order. */
export function shardOf(items, index, count, seconds = readSeconds()) {
  const byName = new Map(items.map(item => [item.name, item]));
  const owner = weighedSlices(Object.fromEntries(items.map(item => [item.name, costOf(item, seconds)])), count);
  return Object.keys(owner).filter(name => owner[name] === index).map(name => byName.get(name));
}

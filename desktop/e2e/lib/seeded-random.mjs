// The page's Math.random from one seed, the same in the live run that records and in its replay (lib/live-row.mjs, replay-net.mjs): a site that shows a
// survey or picks a variant by a random draw draws the same way both times (13 Oct 2026: a job board's "Your opinion matters" survey showed in a replay only).
// Each document starts the sequence again from the seed. Guard: e2e/test/net-record.test.mjs.
/* global window */

// A small, fast, deterministic generator (mulberry32): -> a function returning [0, 1).
export const sequence = seed => { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// Every page `context` opens from now on draws its Math.random from `seed`. -> true when set.
export async function seedRandom(context, seed) {
  if (!Number.isFinite(seed)) return false;
  await context.addInitScript(value => {   // the generator inline (a page's CSP may refuse eval): the same as sequence() above
    let state = value >>> 0;
    window.Math.random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, seed % 4294967296);
  return true;
}

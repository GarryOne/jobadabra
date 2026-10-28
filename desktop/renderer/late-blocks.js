// Blocks drawn from data that comes after the page's first paint, above content already drawn (owner, 26 Oct 2026: the Find jobs card came 2-3 s
// late and pushed the job list down; "Let's have skeleton loading card or caching which would be instant, or both"). Each one keeps what it last
// drew (this Mac's localStorage, small and free of job texts), the page's first paint draws that at once, a skeleton holds the place while nothing
// is kept yet (a first start), and the real data then replaces it in place, so nothing below moves.
// A new block shown late above drawn content joins LATE_BLOCKS. Guarded by test/late-blocks.test.js; the UI Finder's late-shift check
// (e2e/lib/shift.mjs) finds one that was missed. Application questions does the same with its own cache (pages/jobs-questions.js).
export const LATE_BLOCKS = {
  'find-card': 'Jobs: the Find jobs card (pages/jobs-find.js)',
  'jobs-talking': 'Jobs: In conversation (pages/jobs-talking.js)',
  'jobs-suggestions': 'Jobs: Suggestions for your search, read with Focus (pages/focus-suggestions.js)',
  'focus-chart-block': 'Focus: the last 14 days chart in Today\'s progress (pages/focus-chart.js)',
};
const KEY = 'jp-late-blocks';

const all = storage => { try { return JSON.parse(storage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
export const keptBlock = (id, storage = globalThis.localStorage) => all(storage)[id];

// Written only when it changed (the Jobs list redraws on every key typed in its search box).
export function keepBlock(id, value, storage = globalThis.localStorage) {
  if (!(id in LATE_BLOCKS)) throw new Error(`${id} is not in LATE_BLOCKS (renderer/late-blocks.js)`);
  const blocks = all(storage);
  if (JSON.stringify(blocks[id]) === JSON.stringify(value)) return;
  try { storage.setItem(KEY, JSON.stringify({...blocks, [id]: value})); } catch { /* no storage: the skeleton holds the place next time */ }
}

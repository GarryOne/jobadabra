// What a finished Find jobs run offers (owner, 26 Oct 2026: "It should be suggested to the user as an action button"): how many refused sites the
// "Find jobs using your browser" button would read now. Asking reads nothing (the press does, lib/refused-now.js). No imports of the pipeline: run() is
// passed in, so pipeline-tasks.js and refused-reads.js both use it without a loop. Guard: test/refused-reads-button.test.js.
// The refused sites due now, for the current search (src/sources/refused_reads.py queue: rests, the AI judge); [] on any failure.
export async function dueSites(storage, run) {
  try {
    const {stdout} = await run(storage, ['src.desktop', 'refused-queue']);
    return JSON.parse(String(stdout).trim().split('\n').pop()).sites || [];
  } catch { return []; }
}

// Kept in settings for the run's result and ⌘K (renderer/pages/browser-offer.js): {count, names, at}, or null.
export async function offer(storage, run) {
  const sites = await dueSites(storage, run);
  storage.saveSettings({refusedOffer: sites.length ? {count: sites.length, names: sites.slice(0, 3).map(site => site.name), at: new Date().toISOString()} : null});
  return sites.length;
}

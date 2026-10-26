// What the "Find jobs using your browser" offer on a finished Find jobs run's card says, and when (pure, no page: its test runs without a DOM).
// Used by pages/browser-offer.js (the card) and nav.js (⌘K); the count is settings.refusedOffer (lib/refused-offer.js). Guard: test/refused-reads-button.test.js.
export const LABEL = 'Find jobs using your browser';
export const ALLOW = 'The extension needs “Work on every job site” once: open its settings in Chrome and press Allow.';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isSearch = run => run?.kind === 'search';
const newestSearch = (runs = []) => runs.filter(run => isSearch(run) && !run.live).sort((a, b) => Number(b.id) - Number(a.id))[0] || null;

// The offer on this run's card, or null: only the newest finished Find jobs run, and only while refused sites are due.
export function browserOffer(run, {runs = [], settings = {}} = {}) {
  const offer = settings?.refusedOffer, count = Number(offer?.count) || 0;
  if (!isSearch(run) || run.live || !count) return null;
  const newest = newestSearch(runs);
  if (newest && String(newest.id) !== String(run.id)) return null;
  const names = (offer.names || []).slice(0, 3), more = count - names.length;
  const which = names.length ? ` (${names.join(', ')}${more > 0 ? ` and ${more} more` : ''})` : '';
  return {count, at: offer.at, allow: settings.refusedNeedsAllow === true,
    text: `${plural(count, 'site')}${which} refused Jobadabra. Your browser can read ${count === 1 ? 'it' : 'them'}: one at a time, in a private window, without your logins.`};
}

// ⌘K: brings you to the button on that run's card (it does not press it), or null when nothing is offered.
export function paletteEntry({runs = [], settings = {}} = {}) {
  const run = newestSearch(runs), offer = browserOffer(run, {runs, settings});
  return offer ? {label: LABEL, hint: `Read the ${plural(offer.count, 'site')} that refused Jobadabra, in your browser`, runId: run.id} : null;
}

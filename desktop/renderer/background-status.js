// A hidden-browser session's status words (sessions list, dock, nav badge, and the card's pill) from its own background state, not from a Chrome tab it never had. Guard: test/background-status.test.js.

const WORDS = {
  queued: ['Queued', 'neutral'], preflight: ['Filling', 'info'], filling: ['Filling', 'info'], ready_for_review: ['Ready for review', 'warn'],
  needs_user_handoff: ['Needs you', 'warn'], manual_submit_required: ['Needs you', 'warn'], waiting_to_submit: ['Submitting soon', 'info'], submitting: ['Submitting…', 'info'],
};

/**
 * `ready` / `fields` are the card's page facts (all required fields filled; filled of total): the same table, only more exact. -> [label, tone] for a session running in Jobadabra's browser while it is queued, filling, waiting on the person or submitting; null for a Chrome session and for a finished one (the usual words).
 * Why (2026-10-28, owner screenshots: Air France queued behind GLOCK said "Filling" and "Tab not found", GLOCK filling said "Can't reach form"): the Chrome-tab words (tab lost, form closed) were
 * applied to sessions that have no Chrome tab; the one background state owns these words.
 */
export function backgroundStatus(item, {ready = false, fields = null} = {}) {
  const state = item?.background?.state, words = WORDS[state];
  if (!words) return null;
  if (state === 'ready_for_review' && ready) return ['Ready to submit', 'good'];   // the card knows the page has no required field left; the list does not read the page
  if (fields?.of && (state === 'filling' || state === 'preflight')) return [`Filling · ${fields.done} of ${fields.of} fields`, 'info'];
  return [...words];
}

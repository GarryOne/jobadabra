// A fold (<details>) that code opens or closes from a state, e.g. the extension card's install steps: set only when the state changes
// (absent → connected), never on a refresh with the same state, so what the person opened or closed stays (owner, 26 Oct 2026: a refresh
// after Add to Chrome closed what he had open). Guarded by test/extension-card-first-paint.test.js, which lists every other fold set by code.
export function foldFollows(details, state, open) {
  if (!details || details.dataset.foldState === state) return;
  details.dataset.foldState = state;
  details.open = open;
}

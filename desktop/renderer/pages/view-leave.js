// What a page must stop when the person goes to another page (the live view's picture stream on Applying). nav.js openView calls leaveView; a page registers with onLeaveView.
// Why (2026-10-28, B follow-up 1): the live view was closed only when another session was drawn, so leaving Applying left the screencast running behind the new page.
const handlers = new Map();

/** Run `stop` whenever the person moves from page `view` to a different page. */
export function onLeaveView(view, stop) { handlers.set(view, [...(handlers.get(view) || []), stop]); }

/** Called by openView with the page left and the page opened; does nothing when the page does not change. A failing handler never blocks the move. */
export function leaveView(from, to) {
  if (!from || from === to) return;
  for (const stop of handlers.get(from) || []) { try { stop(); } catch { /* a page that fails to stop must not hold the person on it */ } }
}

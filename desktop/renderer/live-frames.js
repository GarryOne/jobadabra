// The live view's picture pacing: only the newest picture is ever painted, at most once per display refresh. Guard: test/live-frames.test.js.

/**
 * push(frame) keeps the newest picture and asks for one paint; at the next refresh paint(frame) runs once with that newest picture; clear() drops one not painted yet.
 * schedule(fn): the display refresh (requestAnimationFrame in the window; a manual clock in tests).
 * Why (2026-10-28, owner: "the live view it's very laggish"): main sends a picture per screencast frame (measured 47 a second, 13-23 KB each) and the window decodes each one;
 * idle it keeps up at about 45 a second, a busy window does not, and the queued pictures made the view run behind. A stale picture is worth nothing: drop it before it is decoded.
 * Invariants: at most one paint is scheduled at a time; a paint always shows the last picture pushed before it; no picture, no paint.
 */
export function createFramePacer(paint, schedule = requestAnimationFrame) {
  let newest = null, scheduled = false;
  const run = () => {
    scheduled = false;
    const frame = newest; newest = null;
    if (frame) paint(frame);
  };
  return {
    push(frame) { newest = frame; if (!scheduled) { scheduled = true; schedule(run); } },
    clear() { newest = null; },
  };
}

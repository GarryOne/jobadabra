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

/**
 * Picture age at paint: record(sentAt) when a picture is painted (sentAt = the Date.now() main stamped on it), take() every few seconds -> {frames, fps, p50, p95, max} and start over.
 * Why (2026-10-28, owner: "the live view it's very laggish", no numbers from his machine): the app log now says how old the painted picture was, so the next report has data, not a guess.
 */
export function createLagMeter(now = Date.now) {
  let ages = [], since = now();
  return {
    record(sentAt) { if (Number.isFinite(sentAt)) ages.push(Math.max(0, now() - sentAt)); },
    take() {
      const sorted = ages.sort((a, b) => a - b), seconds = Math.max(0.001, (now() - since) / 1000), at = share => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
      const out = {frames: sorted.length, fps: Math.round((sorted.length / seconds) * 10) / 10, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0};
      ages = []; since = now();
      return out;
    },
  };
}

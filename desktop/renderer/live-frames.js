// The live view's picture pacing: only the newest picture is ever painted, at most once per display refresh. Guard: test/live-frames.test.js.

/**
 * push(frame) keeps the newest picture and asks for one paint; at the next refresh paint(frame) runs once with that newest picture; clear() drops one not painted yet.
 * schedule(fn): the display refresh (requestAnimationFrame in the window; a manual clock in tests).
 * Why (2026-10-28, owner: "the live view it's very laggish"): main sends a picture per screencast frame (measured 47 a second, 13-23 KB each) and the window sets each on the image.
 * Hypothesis, not yet measured on the owner's Mac: a busy window falls behind setting each one. A stale picture is worth nothing, so only the newest is painted; createLagMeter's log line confirms or refutes this.
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
 * The window's picture: first(message) paints at once, frame(message) paints the newest once per refresh; both set `img.src` and call onShown(message) (size and lag bookkeeping).
 * session-live.js sets the live image only through this sink; test/live-frames.test.js pins the sink's own behaviour.
 */
export function createPictureSink(img, schedule = requestAnimationFrame, onShown = () => {}) {
  const show = message => { img.src = `data:image/jpeg;base64,${message.data}`; onShown(message); };
  const pacer = createFramePacer(show, schedule);
  return {first: show, frame: pacer.push, clear: pacer.clear};
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

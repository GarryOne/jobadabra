// The service worker's lag probe: a 1 s tick notes how late each tick ran, so a stall can be told apart (own event loop, or Chrome around it).
// Pure: the clock, the timer and the line writer are injected (log.js wires the real ones), so a test plays a stall without waiting.

// Design (1 Nov 2026, a8, #2608): the probe is a spectator, like the log it feeds.
// - One interval tick, nothing else. A tick calls no chrome.* API, so it never resets Chrome's 30 s idle timer; a timer does not keep an MV3 worker alive either.
//   When Chrome ends an idle worker the interval dies with it, and the next worker's first start() sets a fresh baseline: a sleeping worker writes nothing and keeps nothing alive.
// - A tick that runs >= LATE_NOTE_MS later than its slot calls onLate({lagMs, burstTicks}) once; burstTicks counts the late ticks in a row (an on-time tick ends the burst).
//   A frozen worker (or a Mac that slept) also shows as one late tick: it cannot be told apart from a blocked loop, and for the question "was the worker running?" it is the same answer.
// - worstSince(from) answers "how late was the loop during [from, now]?" for a log cycle, counting the tick that is overdue right now (a stall ends with the cycle's await
//   and the late tick in the same turn, in either order) and only the part of a stall that lies inside the window.
export const TICK_MS = 1000;
export const LATE_NOTE_MS = 2000;
const NOISE_MS = 100;       // a tick under this late is scheduling jitter, not kept
const KEEP_MS = 120000;     // the late ticks of the last two minutes answer worstSince

/** Build a probe; `now()` is the clock, `onLate(fields)` writes the one line for a late tick. */
export function createLagProbe({now, onLate}) {
  let last = now(), running = false, burst = 0, late = [];
  const overdue = at => Math.max(0, at - last - TICK_MS);
  function tick() {
    const at = now(), lagMs = overdue(at);
    last = at;
    late = late.filter(entry => at - entry.at <= KEEP_MS);
    if (lagMs >= NOISE_MS) late.push({at, lagMs});
    burst = lagMs >= LATE_NOTE_MS ? burst + 1 : 0;
    if (burst) onLate({lagMs, burstTicks: burst});
  }
  return {
    tick,
    /** Start ticking through `schedule(tick, ms)`; the baseline is now, so a worker that just woke reports no lag for the time it slept. */
    start(schedule) { last = now(); running = true; schedule(tick, TICK_MS); },
    /** The worst lag (ms) inside [from, now], or undefined when the probe is not running (a harness, a test): then a line says nothing about it. */
    worstSince(from) {
      if (!running) return undefined;
      const at = now();
      const inside = [...late, {at, lagMs: overdue(at)}].map(entry => Math.min(entry.lagMs, Math.max(0, entry.at - from)));
      return inside.reduce((worst, ms) => Math.max(worst, ms), 0);
    },
  };
}

// Turns the fill overlay on for its short early wait at a fill page's first moment: early-dim.js injects it right after panel-overlay.js, in the same call, so nothing waits on a second round trip.
window.__jobPilottoOverlay?.earlyOn?.();

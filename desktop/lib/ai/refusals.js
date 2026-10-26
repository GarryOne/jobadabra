// Our AI and its lines, as the Anthropic API engine (anthropic-api.js) meets them on a Free AI key: before a call, a line already reached (the gate main sets,
// lib/ai-caps.js) stops it at once; a refused call (429/503) is heard. The listeners (main: lib/app-allowance.js) open the top-up dialog or ask the site which line.
// Nothing else here: no retry, no wording. Guard: test/ai-caps.test.js.
const listeners = new Set();
let gate = () => null;

export const onRefused = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const setGate = fn => { gate = typeof fn === 'function' ? fn : () => null; };

// The line reached now -> {capped, message, resetsAt} or null; never throws.
export function capNow() {
  try { return gate() || null; } catch { return null; }
}

// A call refused by the site ({status}) or stopped here by a known line ({status: 429, cap}).
export function heard(error, cap = null) {
  if (!cap && ![429, 503].includes(error?.status)) return;
  for (const listener of listeners) { try { listener({status: error?.status || 429, cap}); } catch { /* a listener never breaks the caller's error */ } }
}

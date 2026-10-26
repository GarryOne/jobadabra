// What the Focus "quick check" line says and when (pure, no page: its test runs without a DOM). Used by pages/focus-check.js; guard: test/focus-check.test.js.
export const CHECK_WAIT_MS = 12 * 60 * 1000;   // lib/refused-reads.js CHECK_WAIT_MS: a little longer than the extension holds the hidden window
export const checksOf = (settings, now = Date.now()) => (settings?.refusedCheckWaiting || []).filter(entry => now - entry.at < CHECK_WAIT_MS).map(entry => entry.host);
export const checkLine = hosts => hosts.length === 1 ? `${hosts[0]} wants a quick check from you` : `${hosts.length} sites want a quick check from you`;

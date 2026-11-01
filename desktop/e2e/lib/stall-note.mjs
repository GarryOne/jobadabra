// A run ended by its cap while the extension was still "deciding" says how long the app log had been quiet and after which extension line (17 Oct 2026: a bare "(284 s)" hid a 214 s stall).
// Guard: test/stall-note.test.mjs.
const LINE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) \[extension\] (.*)$/;

// -> '' when the log has no extension line or the quiet is under `minSeconds`; else 'stalled N s after "<line>"' (the line cut to 90 characters, page words and braces left out).
export function stallNote(logText, nowMs, minSeconds = 30) {
  let last = null;
  for (const line of String(logText || '').split('\n')) { const m = LINE.exec(line); if (m && !/progress: |tab with the fill mark seen/.test(m[2])) last = m; }
  if (!last) return '';
  const quiet = Math.round((nowMs - Date.parse(last[1])) / 1000);
  if (!(quiet >= minSeconds)) return '';
  return `stalled ${quiet} s after "${last[2].replace(/\s*\{.*$/, '').slice(0, 90)}"`;
}

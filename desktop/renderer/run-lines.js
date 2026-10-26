// How a run's log keeps its lines, the same in the app (lib/pipeline-queue.js) and the window's live log (pages/jobs.js): a row of "still
// here" lines keeps its newest; a counter replaces the earlier one of its kind; every other line stays. Guarded by: test/live-updates.test.js,
// test/live-status-line.test.js.
// A line that says "still here" (the engine's wait for the run lock, or the app's own heartbeat): one in a row is kept, the newest, so a long
// quiet stretch reads as one live line, not a wall of them (the window does the same, renderer/pages/jobs.js).
export const STATUS_LINE = /^(?:⏳ Still running|Another Jobadabra search is running)/;
// A counter line ("⏳ Reading employer job sites: 419 of 1057", "Run counts: looked=…") replaces the earlier one of its kind wherever it is: only
// the newest value is read, and a long search's ~900 ticks pushed its step results ("Job boards: a web search found …") out of the last 300
// lines the window gets (owner's run 578c360d2620, 26 Oct 2026). Results are never dropped. Guarded by: test/live-updates.test.js.
const counterKind = line => (/^Run counts: /.test(line) ? 'Run counts' : /^⏳ ([^:·]+?)(?::| ·)/.exec(line)?.[1] ?? null);
export function keepRunLine(log, line) {
  const kind = counterKind(line);
  const at = kind === null ? -1 : log.findLastIndex(old => counterKind(old) === kind);
  if (at >= 0) log.splice(at, 1);
  else if (STATUS_LINE.test(line) && STATUS_LINE.test(log.at(-1) || '')) log.pop();
  log.push(line);
  return log;
}

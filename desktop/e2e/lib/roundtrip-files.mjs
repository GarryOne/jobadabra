// Job: wait on state
// Compare restored local files against their export and the current launch's store-drop evidence.

/** Return file-specific differences; only a drop recorded in the supplied current-launch log excuses a missing copy. */
export function roundTripFileDifferences(before, after, launchLog) {
  // Why (29 Oct 2026, st): run 40943734538 correctly dropped profile copies after import; earlier launches cannot excuse missing restored bytes.
  const dropped = new Set();
  for (const line of launchLog.split(/\r?\n/)) {
    const match = /\[files\] local copies dropped, the store has them (\{.*\})$/.exec(line);
    if (!match) continue;
    try {
      const files = JSON.parse(match[1]).files;
      if (Array.isArray(files)) for (const name of files) dropped.add(name);
    } catch { /* an incomplete log line proves no completed drop */ }
  }
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(name => {
    if (before[name] === after[name] || (after[name] === null && dropped.has(name))) return [];
    return [`files.${name} ${JSON.stringify(before[name])} -> ${JSON.stringify(after[name])}`];
  });
}

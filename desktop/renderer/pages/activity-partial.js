// A run that finished with a result and only a few sources failing: the failure is one small line under the result card, never a box that replaces it.
// Guarded by desktop/test/activity-partial.test.js (every producer's state: result + failed sources keeps its card; a real failure keeps its box).
// The engine's own line for crawled feeds that did not answer (src/notion/cron_report.py): "1 feed(s) failed: Oxylabs, Acme."
const SOURCES_FAILED = /^(\d+) (?:feed|source)\(s\) failed(?::\s*(.*?))?\.?$/i;
const MORE = /\s+and \d+ more$/i;   // the engine names at most 6 and says how many more

// {partial: {count, names} | null, rest: the warnings that are not about unanswered sources}
export function splitPartial(warnings) {
  const rest = [];
  let partial = null;
  for (const line of warnings || []) {
    const match = SOURCES_FAILED.exec(String(line).trim().replace(/^[-•]\s+/, ''));   // the report's own list marker ("- 7 feed(s) failed")
    if (!match) { rest.push(line); continue; }
    partial = {count: (partial?.count || 0) + Number(match[1]), names: [...(partial?.names || []), ...(match[2] || '').replace(MORE, '').split(/,\s*/).filter(Boolean)]};
  }
  return {partial, rest};
}

export const partialWords = ({count, names}) => {
  const more = names.length && count > names.length ? ` and ${count - names.length} more` : '';
  return `${count} source${count === 1 ? '' : 's'} didn’t answer${names.length ? `: ${names.join(', ')}${more}` : ''}`;
};

// The line under the card: what failed in a few words, and "details" (the technical log) on its right.
export function showPartial(partial) {
  document.getElementById('activity-partial').hidden = !partial;   // no core.js import: this file's pure parts are tested without a window
  if (partial) document.getElementById('activity-partial-text').textContent = partialWords(partial);
}

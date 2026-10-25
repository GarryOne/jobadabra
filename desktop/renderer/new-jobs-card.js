// A finished search that found new jobs but sent no digest (they are not scored yet): its result card, built from the engine's "New job: <title> | <company> | <url>" log lines.
// Guarded by desktop/test/new-jobs-card.test.js (the card exists for every such run; a digest, when there is one, wins).
const NEW_JOB = /^New job: (.+?) \| ([^|]*?) \| (\S*)(?: \| (\d+))?$/;   // the fit after the address: only a run that already has the scores (Always on)

export const newJobItems = lines => (lines || []).map(line => NEW_JOB.exec(String(line))).filter(Boolean)
  .map(([, title, company, url, fit]) => ({title, company, url, fit: fit ? Number(fit) : null, section: 'new'}));

// The same digest card the run-card renderer draws (run-card.js: "Not scored" pills, "N of these are not in Jobs yet", View in Jobs).
// A run with new jobs and no lines naming them (an older run) still says its count: the card, never just the header line.
export function newJobsCard(run, lines) {
  if (!run || run.live || !run.ok || !(run.new > 0)) return null;
  return {kind: 'digest', fresh: run.new, items: newJobItems(lines), own: true};   // own: these are this run's jobs, by name
}

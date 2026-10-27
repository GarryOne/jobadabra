// Which recorded cases a pull request's page-cases run leaves to main and the daily run: the slow ones (slow-cases.json, written by tools/slow-page-cases.mjs from measured seconds),
// unless the PR touches that case's own folder (desktop/e2e/recorded/<case>/). Main and the daily run replay every case. Owner, 17 Oct 2026: PR page cases in half the time.
// Also on an extension change (owner, 27 Oct 2026: "One bug in hundreds of PRs, that's low value": since 17 Oct one PR, #1621, broke two slow cases and main was red ~25 h; not worth +3 runner-min per shard on every extension PR).
// Guard: e2e/test/replay-slow.test.mjs (the split, the PR log line, the workflow sets it for pull_request only).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SLOW_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'slow-cases.json');

// -> [case names] the PR touches: repo-relative changed paths under desktop/e2e/recorded/<case>/.
export const touchedCases = changed => [...new Set(changed.map(file => /^desktop\/e2e\/recorded\/([^/]+)\//.exec(file)?.[1]).filter(Boolean))];

export const readSlow = (file = SLOW_FILE) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {slow: []}; } };

// -> {run: [cases], left: [{name, why}]}. A case not in the slow list (a new one, or never measured) always runs.
export function splitForPr(cases, {slow = [], touched = []} = {}) {
  const run = [], left = [];
  for (const item of cases) {
    if (slow.includes(item.name) && !touched.includes(item.name)) left.push({name: item.name, why: 'slow, and this PR does not touch its folder'});
    else run.push(item);
  }
  return {run, left};
}

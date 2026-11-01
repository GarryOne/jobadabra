// Job: report health
// The last check before a build is approved for beta testers (e2e.yml, promote job): do this run's findings contain a high-severity one that is real?
//   node block-check.mjs --artifacts <dir> [--no-ai]   (needs `gh` and GH_TOKEN with issues: read)
// --no-ai: only the suites' own deterministic findings (layout checks) decide; an AI review's findings are ignored. Why (1 Nov 2026, owner: "I don't think this should be a gate for beta
// which is invariable (depending on the AI response)"): the beta's Release jobs pass it, the night burn-in's review stays a report.
// Prints each blocking finding and exits 1; exits 0 when there is none. Rules: lib/triage.mjs blockers().
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {LABEL, blockers, normalize} from './lib/triage.mjs';
import {filesNamed} from './triage.mjs';

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/**
 * The findings of this run that keep a build away from beta testers (rules: lib/triage.mjs blockers()).
 * @param {{artifacts: string, issues: object[], ai?: boolean}} args artifacts = the downloaded e2e-artifacts folder, issues = the open UI-loop issues from `gh`, ai = false reads only the
 *   suites' own ui-findings.json (an AI review's ai-findings.json is ignored).
 * @returns {object[]} the blocking findings; empty when none (a missing or unreadable file contributes nothing, never an error).
 */
export function blocking({artifacts, issues, ai = true}) {
  const found = filesNamed(artifacts);
  const findings = normalize({ui: found['ui-findings.json'].flatMap(file => read(file) || []), ai: ai ? found['ai-findings.json'].flatMap(file => (read(file) || {}).findings || []) : []});
  return blockers(findings, issues);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const artifacts = args[args.indexOf('--artifacts') + 1];
  const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '300', '--json', 'number,state,labels,body,comments,title'], {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024}));
  const list = blocking({artifacts, issues, ai: !args.includes('--no-ai')});
  for (const finding of list) console.log(`BLOCKING ${finding.view}: ${finding.title} (${finding.source})`);
  console.log(list.length ? `${list.length} real high-severity finding(s): the build is not approved.` : 'No real high-severity finding in this run.');
  process.exit(list.length ? 1 : 0);
}

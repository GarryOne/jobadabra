// Propose the step-level suspension and its owner issue for steps that are red on code unchanged since they last passed ("same code, different result": flaky).
// Job: report health
// Usage: node tools/suspend-flip.mjs (--run <red e2e run id> | --verdicts recorded.json) --owner <login> [--registry file] [--dry-run | --open] [--repo owner/repo]
// Input: the verdicts of tools/flaky-verdict.mjs (--json) for the run, or a recorded file of them. Only `flaky` verdicts propose; `changed` is a regression and `unknown` has no evidence.
// Why (31 Oct 2026, owner: "Means its flaky, Means our redesign and guardarails are not fully working"; spec row 33): the trigger was a hand re-run that came out green (a same-commit
// attempt flip); since row 32 no job runs twice, so it is a step red on a commit whose diff from that step's last green touches none of the files it runs. The unit is the STEP, not its suite.
// Invariants: never edit the registry (a PR does, so the owner sees it: rule E); no network in dry-run (the default) when --verdicts is given; only --open creates issues, one per step.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {stepEntryProblems} from './lanes-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RETURNS = 'Back to the backbone when its fix PR lands and the next 3 main runs pass it.';
const TITLE = 'Flaky step';
const short = (text, max) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text));
/** The issue title for a step; also what an open issue is looked up by. */
export const issueTitle = (suite, step) => `${TITLE} ${suite} · ${short(step, 80)}`;

/**
 * Suspension proposals for the flaky verdicts of a red run, each with the registry entry (without `issue`, which is the issue's own URL) and the owner issue.
 * verdicts: tools/flaky-verdict.mjs items {suite, step, verdict, green, redSha, redUrl, message, movedFiles, stepFileCount}. registry: lanes.json parsed; a step already listed is left alone.
 */
export function suspensions({verdicts = [], registry = {}, owner, since = new Date().toISOString().slice(0, 10)}) {
  if (!owner?.trim()) throw new Error('A named --owner is required for a suspension.');
  const out = [], seen = new Set();
  for (const item of verdicts.filter(found => found.verdict === 'flaky')) {
    const key = JSON.stringify([item.suite, item.step]);
    if (seen.has(key) || registry.steps?.[item.suite]?.[item.step]) continue;
    seen.add(key);
    const red = `${item.redSha.slice(0, 7)}${item.redUrl ? ` (${item.redUrl})` : ''}`, green = `${item.green.sha.slice(0, 7)} (${item.green.url})`;
    const same = item.green.sha === item.redSha;
    const why = `Failed on ${red} and passed on ${green}; ${same ? 'that is the same commit' : `none of the ${item.stepFileCount ?? 'step'} files it runs changed between them`}. A step red on unchanged code cannot protect a PR.`;
    const entry = {lane: 'suspended', since, owner, why, returns: RETURNS};
    const problems = stepEntryProblems({...entry, issue: 'https://github.com/o/r/issues/1'});   // the issue URL comes from --open; everything else is checked now
    if (problems.length) throw new Error(problems.join('; '));
    out.push({suite: item.suite, step: item.step, entry, issue: {title: issueTitle(item.suite, item.step), body: issueBody({item, entry, same, red, green})}});
  }
  return out;
}

function issueBody({item, entry, same, red, green}) {
  return [`Owner: @${entry.owner}`, '', entry.why, '',
    '**This step does not protect you now:** it still runs and shows its result, but it never fails a job or blocks a beta while suspended.', '',
    `- Suite: \`${item.suite}\``, `- Step: ${item.step}`, `- Red: ${red}`, `- Green (same step passed): ${green}`,
    same ? '- The green ran on the very same commit.' : `- Between them ${item.movedFiles ?? '?'} files changed; none of the ${item.stepFileCount ?? '?'} files this step runs (its suite, the harness it imports, the app files its coverage gives it, \`extension/\`, \`src/\`).`,
    '', 'Failure text:', '', '```', short(item.message || '(none recorded)', 1500), '```', '',
    'Fix the **non-deterministic input** (a real browser or worker, load, a race, a clock, the outside world) for the whole class of steps that share it, and the guard that let an unproven step block; never this one step, never a re-run.',
    '', `${RETURNS} Then remove its \`steps\` entry from desktop/e2e/lanes.json (design: backbone → suspended → backbone).`, '',
    'Registry entry to add under `steps.' + item.suite + '` in `desktop/e2e/lanes.json` in a PR (set `issue` to this issue\'s URL and `input` to the input you named):', '',
    '```json', JSON.stringify({[item.step]: {...entry, input: '<the non-deterministic input, once named>', issue: '<this issue URL>'}}, null, 2), '```'].join('\n');
}

function main(argv) {
  const value = flag => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  if (argv.includes('--open') && argv.includes('--dry-run')) throw new Error('Choose --open or --dry-run.');
  const repo = value('--repo') || process.env.GITHUB_REPOSITORY || 'GarryOne/jobadabra';
  if (!value('--run') && !value('--verdicts')) throw new Error('Pass --run <red e2e run id> or --verdicts <recorded JSON file>, and --owner <login>.');
  const registry = JSON.parse(fs.readFileSync(value('--registry') || path.join(ROOT, 'desktop/e2e/lanes.json'), 'utf8'));
  return (async () => {
    let verdicts;
    if (value('--verdicts')) verdicts = JSON.parse(fs.readFileSync(value('--verdicts'), 'utf8'));
    else {
      const {verdictsOfRun} = await import('./flaky-verdict.mjs');
      const redUrl = `https://github.com/${repo}/actions/runs/${value('--run')}`;
      verdicts = (await verdictsOfRun({runId: value('--run'), repo})).map(item => ({...item, redUrl}));
    }
    const found = suspensions({verdicts, registry, owner: value('--owner')});
    for (const {suite, step, entry, issue} of found) {
      console.log(`## Proposed lanes.json entry (steps.${suite})\n${JSON.stringify({[step]: entry}, null, 2)}\n\n## Owner issue\nTitle: ${issue.title}\n\n${issue.body}\n`);
      if (!argv.includes('--open')) continue;
      // Why (29 Oct 2026, owner): suspension belongs to the step until resolved, even if another run or SHA is red again: one open issue per step.
      const open = JSON.parse(execFileSync('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--search', `in:title "${TITLE} ${suite} ·"`, '--limit', '100', '--json', 'number,title,url'], {encoding: 'utf8'}));
      const existing = open.find(row => row.title === issue.title);
      if (existing) { console.log(`Suspension issue already open for ${suite} · ${step}: ${existing.url || `#${existing.number}`}; no duplicate created.`); continue; }
      const url = execFileSync('gh', ['issue', 'create', '--repo', repo, '--assignee', entry.owner, '--title', issue.title, '--body', issue.body], {encoding: 'utf8'}).trim();
      console.log(`Opened ${url}\nAdd to desktop/e2e/lanes.json steps.${suite} in a PR: ${JSON.stringify({[step]: {...entry, issue: url}})}`);
    }
    if (!found.length) console.log('No step is red on unchanged code that is not already suspended; no suspension proposed.');
  })();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`suspend-flip: ${error.message}`); process.exitCode = 1; });
}

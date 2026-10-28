#!/usr/bin/env node
// Sets the one "Gitar: …" label on a PR from Gitar's verdict, so the PR list shows red / yellow / green without opening the PR.
// Why (owner, 28 Oct 2026): "how can I know from this view if the PR has PR comments, or change requested, or not yet approved? … red 'gitar requested changes', or 'approved with suggestions', or green 'fully approved'".
// Why (28 Oct 2026): Gitar records no approving review (#2377 had none), so only its own comment line `<summary><b>Code Review</b> <kbd>…</kbd>` says approved; a verdict older than the head commit is stale and gets no label.
// Usage (workflow .github/workflows/gitar-label.yml): node tools/gitar-label.mjs <pr-number>   needs GH_TOKEN and GITHUB_REPOSITORY; guard tests/test_gitar_label.py.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const LABELS = {
  changes: {name: 'Gitar: changes requested', color: 'd73a4a', description: 'Gitar blocks this PR until its findings are fixed'},
  suggestions: {name: 'Gitar: approved with suggestions', color: 'fbca04', description: 'Gitar approved; a minor finding is still open'},
  approved: {name: 'Gitar: approved', color: '0e8a16', description: 'Gitar fully approved the current head'},
};

/** The verdict kind in Gitar's comment body, or null when it holds no verdict line (e.g. a review in progress). Order matters: "Approved with suggestions" contains "Approved". */
export function verdictKind(body) {
  const line = /<summary><b>Code Review<\/b>\s*<kbd>([^<]*)<\/kbd>/.exec(body || '');
  if (!line) return null;
  const text = line[1];
  if (/changes requested/i.test(text)) return 'changes';
  if (/approved with suggestions/i.test(text)) return 'suggestions';
  if (/approved/i.test(text)) return 'approved';
  return 'changes';   // Why (28 Oct 2026): an unknown Code Review state is not an approval; red is the safe side
}

/** The label name to hold: Gitar's verdict if its comment was written at or after the head commit, else null (a stale approval never stays green). */
export function wantedLabel(body, commentUpdatedAt, headCommittedAt) {
  const kind = verdictKind(body);
  if (!kind || !(Date.parse(commentUpdatedAt) >= Date.parse(headCommittedAt))) return null;
  return LABELS[kind].name;
}

const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8'});
const pages = path => JSON.parse(gh('api', path, '--paginate', '--slurp')).flat();

function main(pr) {
  const repo = process.env.GITHUB_REPOSITORY;
  const reviews = pages(`repos/${repo}/issues/${pr}/comments`).filter(c => c.user.login === 'gitar-bot[bot]' && /Code Review/.test(c.body));
  const latest = reviews.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)).at(-1);
  const head = pages(`repos/${repo}/pulls/${pr}/commits`).at(-1).commit.committer.date;
  const want = latest ? wantedLabel(latest.body, latest.updated_at, head) : null;
  const have = pages(`repos/${repo}/issues/${pr}/labels`).map(l => l.name);
  for (const l of Object.values(LABELS)) {
    if (l.name === want) {
      gh('label', 'create', l.name, '--color', l.color, '--description', l.description, '--force', '-R', repo);
      if (!have.includes(l.name)) gh('pr', 'edit', String(pr), '--add-label', l.name, '-R', repo);
    } else if (have.includes(l.name)) gh('pr', 'edit', String(pr), '--remove-label', l.name, '-R', repo);
  }
  console.log(`gitar-label: #${pr} → ${want || 'no label'}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2]);

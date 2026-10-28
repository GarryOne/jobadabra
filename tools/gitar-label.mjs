#!/usr/bin/env node
// Sets the one "Gitar: …" label on a PR from Gitar's verdict, so the PR list shows red / yellow / green without opening the PR.
// Why (owner, 28 Oct 2026): "how can I know from this view if the PR has PR comments, or change requested, or not yet approved? … red 'gitar requested changes', or 'approved with suggestions', or green 'fully approved'".
// Why (28 Oct 2026): Gitar records no approving review (#2377 had none), so only the verdict line of its own comment says approved; a verdict older than the head commit is stale and gets no label.
// Usage (workflow .github/workflows/gitar-label.yml): node tools/gitar-label.mjs <pr-number>
//   node tools/gitar-label.mjs working <pr-number>   a session says it is handling the comments (tools/ship-watch.sh). Needs GH_TOKEN and GITHUB_REPOSITORY; guard tests/test_gitar_label.py.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const LABELS = {
  changes: {name: 'Gitar: changes requested', color: 'd73a4a', description: 'Gitar blocks this PR until its findings are fixed'},
  suggestions: {name: 'Gitar: approved with suggestions', color: 'fbca04', description: 'Gitar approved; a minor finding is still open'},
  approved: {name: 'Gitar: approved', color: '0e8a16', description: 'Gitar fully approved the current head'},
};
// Gray, our side of the conversation (owner, 28 Oct 2026: "when we acknowledged and working on the feedback, a secondary label, a gray one"; "what's the latest status from Gitar and what's our current action").
export const WAITING = {name: 'Gitar: reviewing', color: '9ca3af', description: 'No Gitar verdict for the current head yet'};
export const WORKING = {name: 'Working on PR comments', color: '6b7280', description: 'A session is applying the review feedback; a push clears it'};

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

/** When the head became the head: the later of its commit date and the first check suite created for it (a commit made at 10:00 and pushed at 11:00 counts as 11:00; Why (#2386, 28 Oct 2026): Gitar flagged commit date as push time). */
function headTime(repo, sha) {
  const committed = JSON.parse(gh('api', `repos/${repo}/commits/${sha}`)).commit.committer.date;
  const suites = JSON.parse(gh('api', `repos/${repo}/commits/${sha}/check-suites`)).check_suites.map(c => c.created_at);
  return [committed, suites.sort()[0]].filter(Boolean).sort().at(-1);   // the first suite created for the head
}

/** The labels a PR should hold: Gitar's current verdict or "reviewing" when it has none for this head; "working" (when since, its time) stays only if it was set after the head's push and Gitar has not approved: a push or an approval ends it (owner, 28 Oct 2026: "if the PR is approved on a subsequent commit, we should clear this gray label"). Why (#2386, Gitar): judged from times, not from the push event, which a Gitar comment run could cancel. */
export function wantedLabels({verdict, workingSince, headTime}) {
  const names = [verdict || WAITING.name];
  if (workingSince && Date.parse(workingSince) >= Date.parse(headTime) && verdict !== LABELS.approved.name) names.push(WORKING.name);
  return names;
}

const ALL = [...Object.values(LABELS), WAITING, WORKING];
const ensure = (repo, l) => gh('label', 'create', l.name, '--color', l.color, '--description', l.description, '--force', '-R', repo);

function setLabels(repo, pr, wanted, have) {
  for (const l of ALL) {
    if (wanted.includes(l.name) && !have.includes(l.name)) { ensure(repo, l); gh('pr', 'edit', String(pr), '--add-label', l.name, '-R', repo); }
    else if (!wanted.includes(l.name) && have.includes(l.name)) gh('pr', 'edit', String(pr), '--remove-label', l.name, '-R', repo);
  }
}

function main(pr) {
  const repo = process.env.GITHUB_REPOSITORY;
  const info = JSON.parse(gh('api', `repos/${repo}/pulls/${pr}`));
  if (info.state !== 'open') return console.log(`gitar-label: #${pr} is ${info.state}, left as it is`);
  const reviews = pages(`repos/${repo}/issues/${pr}/comments`).filter(c => c.user.login === 'gitar-bot[bot]' && /Code Review/.test(c.body));
  const latest = reviews.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)).at(-1);
  const head = headTime(repo, info.head.sha);
  const verdict = latest ? wantedLabel(latest.body, latest.updated_at, head) : null;
  const have = pages(`repos/${repo}/issues/${pr}/labels`).map(l => l.name);
  const workingSince = have.includes(WORKING.name) ? pages(`repos/${repo}/issues/${pr}/events`).filter(e => e.event === 'labeled' && e.label.name === WORKING.name).map(e => e.created_at).sort().at(-1) : null;
  const wanted = wantedLabels({verdict, workingSince, headTime: head});
  setLabels(repo, pr, wanted, have);
  console.log(`gitar-label: #${pr} → ${wanted.join(' + ')}`);
}

function markWorking(pr) {
  const repo = process.env.GITHUB_REPOSITORY;
  ensure(repo, WORKING);
  gh('pr', 'edit', String(pr), '--add-label', WORKING.name, '-R', repo);
  main(pr);   // Why (#2386, Gitar): an approved PR must not keep "working"; the sync drops it again
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.argv[2] === 'working' ? markWorking(process.argv[3]) : main(process.argv[2]);

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
const ensure = (repo, l, run = gh) => run('label', 'create', l.name, '--color', l.color, '--description', l.description, '--force', '-R', repo);

/** Adds and removes labels until the PR holds exactly `wanted`; -> how many it changed. `run` is the gh call (a test passes a fake). */
export function setLabels(repo, pr, wanted, have, run = gh) {
  let changed = 0;
  for (const l of ALL) {
    if (wanted.includes(l.name) && !have.includes(l.name)) { ensure(repo, l, run); run('pr', 'edit', String(pr), '--add-label', l.name, '-R', repo); changed++; }
    else if (!wanted.includes(l.name) && have.includes(l.name)) { run('pr', 'edit', String(pr), '--remove-label', l.name, '-R', repo); changed++; }
  }
  return changed;
}

/** Runs `once` until a fresh read wants no change (at most `max` rounds); -> the rounds run.
 * Why (#2404, Gitar): label runs overlap since no run is cancelled; a run that read a stale verdict and wrote last would leave a stale label. Re-reading
 * after each write makes the last run to finish write the current state. */
export function converge(once, max = 3) {
  let rounds = 0;
  while (rounds < max) { rounds++; if (!once()) break; }
  return rounds;
}

function main(pr) {
  converge(() => syncOnce(pr));
}

const PR_QUERY = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
  state headRefOid
  comments(last: 100) { pageInfo { hasPreviousPage } nodes { author { login } body updatedAt } }
  labels(first: 30) { nodes { name } }
  timelineItems(last: 30, itemTypes: [LABELED_EVENT]) { nodes { ... on LabeledEvent { createdAt label { name } } } }
  commits(last: 1) { nodes { commit { committedDate checkSuites(first: 20) { nodes { createdAt } } } } }
} } }`;

/** The PR's state, Gitar's newest Code Review comment, head time, labels and when "working" was set, from one GraphQL answer; null when Gitar's comment may sit
 * before the 100 newest comments (the caller then reads page by page). Why (29 Oct 2026, api-quota): six REST calls per label run, ~125 runs an hour, were over half
 * of Actions' 1,000-an-hour GITHUB_TOKEN quota; GraphQL is its own bucket and one call. Same head-time rule as headTime(): the later of commit date and first check suite. */
export function fromGraphql(data) {
  const pr = data.repository.pullRequest;
  const reviews = pr.comments.nodes.filter(c => c.author?.login === 'gitar-bot' && /Code Review/.test(c.body));
  if (!reviews.length && pr.comments.pageInfo.hasPreviousPage) return null;
  const commit = pr.commits.nodes[0].commit;
  const latest = reviews.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)).at(-1);
  const workedAt = pr.timelineItems.nodes.filter(e => e.label?.name === WORKING.name).map(e => e.createdAt).sort().at(-1) || null;
  return {
    state: pr.state.toLowerCase(),
    headTime: [commit.committedDate, commit.checkSuites.nodes.map(c => c.createdAt).sort()[0]].filter(Boolean).sort().at(-1),
    review: latest ? {body: latest.body, updated_at: latest.updatedAt} : null,
    labels: pr.labels.nodes.map(l => l.name),
    workingSince: workedAt,
  };
}

/** One GraphQL call for everything a label run reads; null when the thread is too long for it. `run` is the gh call (a test passes a fake). */
export function readPr(repo, pr, run = gh) {
  const [owner, name] = repo.split('/');
  return fromGraphql(JSON.parse(run('api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `pr=${pr}`)).data);
}

/** The same read page by page over REST: for a thread whose Gitar comment is older than the 100 newest. */
function readPrByRest(repo, pr, info) {
  const reviews = pages(`repos/${repo}/issues/${pr}/comments`).filter(c => c.user.login === 'gitar-bot[bot]' && /Code Review/.test(c.body));
  const latest = reviews.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)).at(-1);
  const labels = pages(`repos/${repo}/issues/${pr}/labels`).map(l => l.name);
  const workingSince = labels.includes(WORKING.name) ? pages(`repos/${repo}/issues/${pr}/events`).filter(e => e.event === 'labeled' && e.label.name === WORKING.name).map(e => e.created_at).sort().at(-1) : null;
  return {state: info.state, headTime: headTime(repo, info.head.sha), review: latest ? {body: latest.body, updated_at: latest.updated_at} : null, labels, workingSince};
}

/** One read of the verdict, head and labels, then the writes it needs; -> true when it changed a label. */
function syncOnce(pr) {
  const repo = process.env.GITHUB_REPOSITORY;
  const read = readPr(repo, pr) || readPrByRest(repo, pr, JSON.parse(gh('api', `repos/${repo}/pulls/${pr}`)));
  if (read.state !== 'open') { console.log(`gitar-label: #${pr} is ${read.state}, left as it is`); return false; }
  const verdict = read.review ? wantedLabel(read.review.body, read.review.updated_at, read.headTime) : null;
  const wanted = wantedLabels({verdict, workingSince: read.workingSince, headTime: read.headTime});
  const changed = setLabels(repo, pr, wanted, read.labels);
  console.log(`gitar-label: #${pr} → ${wanted.join(' + ')}`);
  return changed > 0;
}

function markWorking(pr) {
  const repo = process.env.GITHUB_REPOSITORY;
  ensure(repo, WORKING);
  if (pages(`repos/${repo}/issues/${pr}/labels`).some(l => l.name === WORKING.name)) gh('pr', 'edit', String(pr), '--remove-label', WORKING.name, '-R', repo);   // Why (#2386, Gitar): re-adding a present label makes no new labeled event, so its time would stay old
  gh('pr', 'edit', String(pr), '--add-label', WORKING.name, '-R', repo);
  main(pr);   // Why (#2386, Gitar): an approved PR must not keep "working"; the sync drops it again
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.argv[2] === 'working' ? markWorking(process.argv[3]) : main(process.argv[2]);

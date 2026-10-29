#!/usr/bin/env node
// Sets the one "Gitar: …" label on a PR from Gitar's verdict, so the PR list shows red / yellow / green without opening the PR.
// Why (owner, 28 Oct 2026): "how can I know from this view if the PR has PR comments, or change requested, or not yet approved? … red 'gitar requested changes', or 'approved with suggestions', or green 'fully approved'".
// Why (28 Oct 2026; measured again 30 Oct 2026): a head often gets no Gitar review (9 of 60 PRs: an unchanged verdict after a push is only a new comment), so only the
// verdict line of its own comment says approved; a verdict older than the head commit is stale and gets no label.
// Design (30 Oct 2026, owner chose "run only on review + push"): the labels change only on a push (the head moved: "reviewing" until Gitar judges it), on Gitar
// submitting or dismissing a review or posting a new comment (its verdict), and on a session starting work ("working"). Gitar's comment edits change nothing: 151 label runs an hour on
// them used up the repo's REST budget, and the runs that hit the limit left labels wrong in silence (#2516, 29 Oct 2026). Reads are one GraphQL call.
// Usage (workflow .github/workflows/gitar-label.yml): node tools/gitar-label.mjs <pr-number>   (a review event's submitted_at is read from GITHUB_EVENT_PATH)
//   node tools/gitar-label.mjs working <pr-number>   a session says it has started handling the comments. Needs GH_TOKEN and GITHUB_REPOSITORY; guard tests/test_gitar_label.py.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
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

/** A run started by Gitar's review: re-reads (one GraphQL call each) until Gitar's comment was updated at or after the review, at most `tries` times; -> the last read.
 * Why (30 Oct 2026, measured on 25 PRs): Gitar submits its review first and edits the verdict line of its comment 2 s to minutes later, and only the comment tells
 * "approved with suggestions" (an empty COMMENTED review) from a plain comment batch. */
export function awaitComment(read, since, reread, {tries = 12, pause = () => {}} = {}) {
  let current = read;
  for (let tried = 0; since && tried < tries && !(current.review && Date.parse(current.review.updated_at) >= Date.parse(since)); tried++) {
    pause();
    current = reread();
  }
  return current;
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

/** The labels a PR should hold: Gitar's current verdict or "reviewing" when it has none for this head; "working" (when since, its time) stays only if it was set after the head's push and Gitar has not approved: a push or a later approval ends it (owner, 28 Oct 2026: "if the PR is approved on a subsequent commit, we should clear this gray label"). Why (#2386, Gitar): judged from times, not from the push event, which a Gitar comment run could cancel. */
export function wantedLabels({verdict, workingSince, headTime, verdictTime}) {
  const names = [verdict || WAITING.name];
  if (workingSince && Date.parse(workingSince) >= Date.parse(headTime) && (verdict !== LABELS.approved.name || Date.parse(workingSince) > Date.parse(verdictTime))) names.push(WORKING.name);
  return names;
}

const ALL = [...Object.values(LABELS), WAITING, WORKING];
const ensure = (repo, l, run = gh) => run('label', 'create', l.name, '--color', l.color, '--description', l.description, '--force', '-R', repo);

/** Adds one label; creates it (a REST call) only when GitHub says the repo has no such label yet, then adds it again.
 * Why (30 Oct 2026, #2516): the create ran before every add and was the REST call that met the exhausted budget; the labels exist after their first use. */
export function addLabel(repo, pr, l, run = gh) {
  const add = () => run('pr', 'edit', String(pr), '--add-label', l.name, '-R', repo);
  try { add(); } catch (error) {
    if (!/could not add label: .* not found/i.test(error.message)) throw error;   // gh's words for a label the repo lacks, not a missing PR
    ensure(repo, l, run);
    add();
  }
}

/** Adds and removes labels until the PR holds exactly `wanted`; -> how many it changed. `run` is the gh call (a test passes a fake). */
export function setLabels(repo, pr, wanted, have, run = gh) {
  let changed = 0;
  for (const l of ALL) {
    if (wanted.includes(l.name) && !have.includes(l.name)) { addLabel(repo, pr, l, run); changed++; }
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

function main(pr, since = null) {
  // Why (30 Oct 2026): only the first round waits for Gitar's comment; a converge re-read after a write reads at once.
  let wait = since;
  converge(() => { const changed = syncOnce(pr, wait); wait = null; return changed; });
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
  const labels = pr.labels.nodes.map(l => l.name);
  const workedAt = labels.includes(WORKING.name) ? pr.timelineItems.nodes.filter(e => e.label?.name === WORKING.name).map(e => e.createdAt).sort().at(-1) || null : null;   // only while the label is on the PR, as the REST read does (Gitar, #2445): a removed label must not come back
  return {
    state: pr.state.toLowerCase(),
    headTime: [commit.committedDate, commit.checkSuites.nodes.map(c => c.createdAt).sort()[0]].filter(Boolean).sort().at(-1),
    review: latest ? {body: latest.body, updated_at: latest.updatedAt} : null,
    labels,
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

const readLive = (repo, pr) => readPr(repo, pr) || readPrByRest(repo, pr, JSON.parse(gh('api', `repos/${repo}/pulls/${pr}`)));
const WAIT_MS = Number(process.env.GITAR_LABEL_WAIT_MS || 10000);   // between re-reads while Gitar's comment catches up with its review (12 tries: 2 minutes)
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAIT_MS);

/** One read of the verdict, head and labels (after Gitar's comment caught up with the review `since`, if any), then the writes it needs; -> true when it changed a label. */
function syncOnce(pr, since) {
  const repo = process.env.GITHUB_REPOSITORY;
  const read = awaitComment(readLive(repo, pr), since, () => readLive(repo, pr), {pause});
  if (since && !(read.review && Date.parse(read.review.updated_at) >= Date.parse(since))) console.log(`::warning::gitar-label: Gitar's comment on #${pr} did not catch up with its review in 12 reads; labelled from what it read`);
  if (read.state !== 'open') { console.log(`gitar-label: #${pr} is ${read.state}, left as it is`); return false; }
  const verdict = read.review ? wantedLabel(read.review.body, read.review.updated_at, read.headTime) : null;
  const wanted = wantedLabels({verdict, workingSince: read.workingSince, headTime: read.headTime, verdictTime: read.review?.updated_at});
  const changed = setLabels(repo, pr, wanted, read.labels);
  console.log(`gitar-label: #${pr} → ${wanted.join(' + ')}`);
  return changed > 0;
}

function markWorking(pr) {
  const repo = process.env.GITHUB_REPOSITORY;
  const read = readLive(repo, pr);
  // Why (#2386, 29 Oct 2026): a current mark keeps its time; a stale mark is refreshed after a push.
  if (read.state !== 'open') return;
  const present = read.labels.includes(WORKING.name);
  if (present && read.workingSince && Date.parse(read.workingSince) >= Date.parse(read.headTime)) return;
  // Why (#2386, Gitar): a stale mark needs a new event time after the latest push.
  if (present) gh('pr', 'edit', String(pr), '--remove-label', WORKING.name, '-R', repo);
  addLabel(repo, pr, WORKING);
  main(pr); // Reconcile a push or verdict that arrived while marking work.
}

/** The review time a run must wait for: Gitar's review's submitted_at on a pull_request_review event, else null (a push, a new Gitar comment or a by-hand run reads at once). */
export function reviewSince(event, payload) {
  return event === 'pull_request_review' && payload?.review?.user?.login === 'gitar-bot[bot]' ? payload.review.submitted_at || null : null;
}

/** A failure stays red, rate limit or not: a label left wrong in silence is what this design removes (#2516). */
function cli() {
  try {
    let payload = {};
    try {
      if (process.env.GITHUB_EVENT_PATH) payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    } catch { /* An unreadable event file only means no review time to wait for: the run reads at once. */ }
    process.argv[2] === 'working' ? markWorking(process.argv[3]) : main(process.argv[2], reviewSince(process.env.GITHUB_EVENT_NAME, payload));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) cli();

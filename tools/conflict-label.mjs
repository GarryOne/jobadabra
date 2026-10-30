#!/usr/bin/env node
// Puts an orange "Merge conflict" label on every open PR that GitHub says conflicts with its base, and takes it off once the PR merges cleanly, so the PR
// list shows which PRs need main merged in (owner, 30 Oct 2026: "let's add a GH label when the PR has conflicts"; "an orange one … not this [yellow] color").
// Design: one owner (this script), two states (conflict / clean), changed only by GitHub's `mergeable` verdict: CONFLICTING adds the label, MERGEABLE removes
// it, UNKNOWN (still computing after main moved) leaves it. Runs on a push to main (any open PR may now conflict) and on a PR push (it may be fixed).
// Usage (workflow .github/workflows/conflict-label.yml): node tools/conflict-label.mjs. Needs GH_TOKEN and GITHUB_REPOSITORY; guard tests/test_conflict_label.py.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {addLabel} from './gitar-label.mjs';

// Why (owner, 30 Oct 2026): orange, a warning, apart from Gitar's yellow "approved with suggestions" (fbca04) and red "changes requested" (d73a4a).
export const CONFLICT = {name: 'Merge conflict', color: 'f66a0a', description: 'Conflicts with its base branch: merge main into it'};

const QUERY = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
  pullRequests(states: OPEN, first: 100) { nodes { number mergeable labels(first: 30) { nodes { name } } } }
} }`;

/** The open PRs from one GraphQL answer: [{number, mergeable: CONFLICTING|MERGEABLE|UNKNOWN, labeled}]. */
export function fromGraphql(data) {
  return data.repository.pullRequests.nodes.map(p => ({number: p.number, mergeable: p.mergeable, labeled: p.labels.nodes.some(l => l.name === CONFLICT.name)}));
}

/** The label edits the open PRs need: add where GitHub says CONFLICTING, remove where MERGEABLE; UNKNOWN changes nothing. */
export function edits(prs) {
  return prs.flatMap(p => p.mergeable === 'CONFLICTING' && !p.labeled ? [{pr: p.number, add: true}]
    : p.mergeable === 'MERGEABLE' && p.labeled ? [{pr: p.number, add: false}] : []);
}

/** Reads until no PR is UNKNOWN or `tries` re-reads ran; -> the last read.
 * Why (30 Oct 2026): after main moves GitHub recomputes each PR's mergeable state in the background, and a read is what asks for it. */
export function settle(read, {tries = 6, pause = () => {}} = {}) {
  let prs = read();
  for (let tried = 0; tried < tries && prs.some(p => p.mergeable === 'UNKNOWN'); tried++) { pause(); prs = read(); }
  return prs;
}

const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8'});

/** Applies one edit: an add goes through gitar-label's addLabel (the label is created only when gh says the repo lacks it); a removal never creates it. */
export function apply(repo, edit, run = gh) {
  if (edit.add) addLabel(repo, edit.pr, CONFLICT, run);
  else run('pr', 'edit', String(edit.pr), '--remove-label', CONFLICT.name, '-R', repo);
}

/** One GraphQL read of every open PR's mergeable state and label. `run` is the gh call (a test passes a fake). */
export function readOpen(repo, run = gh) {
  const [owner, name] = repo.split('/');
  return fromGraphql(JSON.parse(run('api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`)).data);
}

const WAIT_MS = Number(process.env.CONFLICT_LABEL_WAIT_MS || 10000);   // between re-reads while GitHub computes (6 tries: a minute)
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAIT_MS);

/** Settles the open PRs' state, applies the edits and prints them; a failure stays red. */
function cli() {
  try {
    const repo = process.env.GITHUB_REPOSITORY;
    const prs = settle(() => readOpen(repo), {pause});
    for (const edit of edits(prs)) { apply(repo, edit); console.log(`conflict-label: #${edit.pr} ${edit.add ? '+' : '-'} ${CONFLICT.name}`); }
    const unknown = prs.filter(p => p.mergeable === 'UNKNOWN').map(p => `#${p.number}`);
    if (unknown.length) console.log(`::notice::conflict-label: GitHub had not computed ${unknown.join(', ')} yet; the next push to main or to the PR labels them`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) cli();

// The owner's one decision on a red replay gate (owner, 14 Oct 2026: a label, no button): a PR merged into main since the baseline run, labeled `replay-accepted`, with a comment
// `Replay-accept: <reason>` (all its worse rows) or `Replay-accept: <row name> — <reason>` (named rows only), accepts those rows. Only a comment by the repo's owner, a member or a collaborator counts.
// Two readers: the PRs merged since the baseline (the nightly) and the PR's own label + comments (readPrAccepts: the PR gate, site-replays-pr.yml). Pure parts (guard: e2e/test/replay-accepts.test.mjs) + one gh reader. Run: node replay-accepts.mjs <baseline results.json | -> <out accepts.json>   (REPLAY_ACCEPTS_FAKE=<file>: a test's list of PRs instead of gh)
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export const LABEL = 'replay-accepted', TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'], DASH = ' — ';
export const HINT = `If intended: label the PR \`${LABEL}\` and comment \`Replay-accept: <reason>\` (or \`Replay-accept: <row name>${DASH}<reason>\`)`;

// (the PRs merged since the baseline: [{number, labels: [name], comments: [{body, authorAssociation}]}]) -> {entries: [{pr, text}]}: one entry per accepting comment, text ''
// when a labeled PR has no such comment from a trusted person (the gate then says "add the reason").
export function entriesOf(prs) {
  const entries = [];
  for (const pr of prs) {
    if (!(pr.labels || []).map(label => label.name ?? label).includes(LABEL)) continue;
    const found = (pr.comments || []).filter(comment => TRUSTED.includes(comment.authorAssociation)).flatMap(comment => [...String(comment.body || '').matchAll(/^\s*Replay-accept:\s*(.+?)\s*$/gim)].map(match => ({text: match[1], ...(comment.url ? {url: comment.url} : {})})));
    if (found.length) entries.push(...found.map(one => ({pr: pr.number, ...one}))); else entries.push({pr: pr.number, text: ''});
  }
  return entries;
}

// (a row's name, the entries, every row's name) -> {pr, reason} when an entry accepts this row, {pr, reason: ''} when a labeled PR gave no reason, or null.
// An entry naming a row ("<row> — <reason>") accepts that row only; any other text is the reason for all rows.
export function acceptFor(name, entries = [], names = []) {
  let silent = null;
  for (const {pr, text, url} of entries) {
    const named = names.find(other => text.startsWith(other + DASH));
    if (!text) silent ||= {pr, reason: ''};
    else if (named ? named === name : true) return {pr, ...(url ? {url} : {}), reason: named ? text.slice(named.length + DASH.length).trim() : text};
  }
  return silent;
}

// The ratchet's accept (owner, 15 Oct 2026): only an entry that NAMES the row ("<row> — <reason>") counts; a bare "Replay-accept: <reason>" accepts nothing for a pinned row.
export function acceptNamed(name, entries = [], names = []) {
  for (const {pr, text, url} of entries) {
    const named = names.find(other => text.startsWith(other + DASH));
    if (named === name) return {pr, ...(url ? {url} : {}), reason: text.slice(named.length + DASH.length).trim()};
  }
  return null;
}

const run = (args, fetcher) => (fetcher || (list => execFileSync('gh', list, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})))(args);
// (the baseline results' sha) -> {merged: [{number, title}], entries}: the PRs merged into main after that sha. No sha, no accepts.
export function readAccepts(sha, {env = process.env, fetcher} = {}) {
  if (env.REPLAY_ACCEPTS_FAKE) { const fake = JSON.parse(fs.readFileSync(env.REPLAY_ACCEPTS_FAKE, 'utf8')); return {merged: fake.map(({number, title}) => ({number, title})), entries: entriesOf(fake)}; }
  if (!sha) return {merged: [], entries: []};
  try {
    const repo = env.GITHUB_REPOSITORY, since = new Set(run(['api', `repos/${repo}/compare/${sha}...main`, '--paginate', '--jq', '.commits[].sha'], fetcher).split('\n').filter(Boolean));
    const prs = JSON.parse(run(['pr', 'list', '-R', repo, '--state', 'merged', '--base', 'main', '--limit', '100', '--json', 'number,title,mergeCommit,labels,comments'], fetcher)).filter(pr => since.has(pr.mergeCommit?.oid));
    return {merged: prs.map(({number, title}) => ({number, title})), entries: entriesOf(prs)};
  } catch (error) { console.error(`replay-accepts: not read (${String(error.message).slice(0, 120)})`); return {merged: [], entries: []}; }
}

// The PR's OWN label and comments (the PR gate: an intended drop is accepted on the PR itself). Live state, read when the gate judges, so a re-run sees a label added since.
export function readPrAccepts(number, {env = process.env, fetcher} = {}) {
  if (env.REPLAY_ACCEPTS_PR_FAKE) return {merged: [], entries: entriesOf([JSON.parse(fs.readFileSync(env.REPLAY_ACCEPTS_PR_FAKE, 'utf8'))])};
  if (!number) return {merged: [], entries: []};
  try {
    const pr = JSON.parse(run(['pr', 'view', String(number), '-R', env.GITHUB_REPOSITORY, '--json', 'number,labels,comments'], fetcher));
    return {merged: [], entries: entriesOf([pr])};
  } catch (error) { console.error(`replay-accepts: PR #${number} not read (${String(error.message).slice(0, 120)})`); return {merged: [], entries: []}; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const at = process.argv.indexOf('--pr'), prNumber = at > 0 ? process.argv[at + 1] : '';
  if (at > 0) process.argv.splice(at, 2);
  const [base, out] = process.argv.slice(2);
  if (!base || !out) { console.error('usage: node replay-accepts.mjs <baseline results.json | -> <out accepts.json> [--pr <number>]'); process.exit(2); }
  let sha = ''; try { sha = base === '-' ? '' : JSON.parse(fs.readFileSync(base, 'utf8')).sha || ''; } catch { /* no baseline */ }
  const result = prNumber ? readPrAccepts(prNumber) : readAccepts(sha);
  fs.writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`replay-accepts: ${result.merged.length} PR(s) merged since the baseline, ${result.entries.length} accept entr${result.entries.length === 1 ? 'y' : 'ies'}`);
}

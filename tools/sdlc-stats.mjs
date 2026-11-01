// The SDLC numbers for /admin/agents/agent-coding (tab "SDLC", owner, 1 Nov 2026: "the entire harness/workflow ... speccing, plan, build, maintain" and "what brings value and it's fast"): per day and per
// check (a workflow's name) on each layer (pr = pull-request runs, main = pushes to main, night = schedule and manual runs) the runs, reds, seconds and what followed each red; plus the four phases' counts.
// Counting only: a check name, counts and seconds leave GitHub, never a branch, a path or commit text. Test: desktop/test/sdlc-stats.test.js. Fed daily by .github/workflows/agent-coding-stats.yml.
// What followed a red (a heuristic, about +-10 points, labelled on the page), classed with classifyFix (product / test / ci / form): on a PR, the diff between the red commit and the next green run of the same
// workflow on that branch (GitHub's compare; measured 1 Nov 2026: 432 of 490 reds were followed by a green on DIFFERENT code, 40 by a re-run of the same commit); on main and at night, the first merge between the red
// and the next green. Green again on the same commit = flaky; code changed but only by a rebase = rebase (cause unclear); never green again = nofix.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {areaOf, classifyFix, fetchMerges, isFixPr, kindOfFile} from './agent-coding-stats.mjs';

const run = (command, args) => execFileSync(command, args, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
const gh = path => JSON.parse(run('gh', ['api', path]));
const day = iso => String(iso).slice(0, 10);
const seconds = (from, to) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)) || 0;
const CATCHES = ['product', 'test', 'ci', 'form', 'flaky', 'rebase', 'nofix'];
const emptyCatches = () => Object.fromEntries(CATCHES.map(key => [key, 0]));
const emptyDay = date => ({day: date, layers: {pr: {}, main: {}, night: {}}, phases: {merged: 0, nospec: 0, unmerged: 0, prCommits: 0, fixAfter: 0, reverts: 0, redMain: 0}, bugs: 0});

/** A run's layer: 'pr' for pull_request, 'main' for a push to main, 'night' for schedule and manual runs; null for anything else (not counted). */
export const layerOf = item => (item.event === 'pull_request' ? 'pr' : item.event === 'push' && item.branch === 'main' ? 'main' : ['schedule', 'workflow_dispatch'].includes(item.event) ? 'night' : null);
/** A merged PR with product files and no spec or doc file: the "no spec" signal of the spec phase. */
export const hasNoSpec = merge => merge.files.some(file => kindOfFile(file) === 'product') && !merge.files.some(file => /^docs\/|\.md$/.test(file));

/** What followed a red run: 'flaky' (green again on the same commit), the class of the first later fixing candidate, or 'nofix'. `greens` = successes of the workflow [{at, sha}]; `fixes` = later candidates [{at, subject, files, lines}] (merges, on main and at night). */
export function catchOf(red, greens, fixes) {
  const later = greens.filter(green => green.at > red.at).sort((a, b) => a.at - b.at)[0];
  if (!later) return 'nofix';
  if (greens.some(green => green.sha === red.sha)) return 'flaky';
  const fix = fixes.filter(item => item.at > red.at && item.at <= later.at + 60000).sort((a, b) => a.at - b.at)[0];
  return fix ? classifyFix(fix) : 'flaky';
}
const DAY_MS = 86400000;
/** The next green run of the red's workflow on the same branch within a day, on different code: [{red, green}] pairs whose diff says what the fix was; null when green again on the same commit, or never green. */
export function nextGreen(red, runs) {
  const greens = runs.filter(item => item.conclusion === 'success' && item.name === red.name && item.branch === red.branch && Date.parse(item.created_at) > Date.parse(red.created_at) && Date.parse(item.created_at) - Date.parse(red.created_at) < DAY_MS);
  if (greens.some(item => item.head_sha === red.head_sha)) return 'same';
  return greens.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0] || null;
}
/** What a PR red turned into: 'flaky' (same commit green again), 'nofix' (never green again), else the class of the diff between the red commit and the green one (input.compares["red...green"] = {status, files, lines, subject}); a rebase (not 'ahead') or a missing diff is 'rebase'. */
export function prCatch(red, runs, compares = {}) {
  const green = nextGreen(red, runs);
  if (!green) return 'nofix';
  if (green === 'same') return 'flaky';
  const diff = compares[`${red.head_sha}...${green.head_sha}`];
  return diff && diff.status === 'ahead' ? classifyFix(diff) : 'rebase';
}
/** The compare pairs the PR layer needs: ["red...green"] for every red in the window followed by a green on different code. Fetch them (fetchCompares), pass them back as input.compares. */
export function pendingPairs(input, {days = 3, now = new Date()} = {}) {
  const from = new Date(now.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10), runs = (input.runs || []).filter(item => layerOf(item) === 'pr' && ['success', 'failure', 'timed_out'].includes(item.conclusion));
  return [...new Set(runs.filter(item => item.conclusion !== 'success' && day(item.created_at) >= from).map(item => { const green = nextGreen(item, runs); return green && green !== 'same' ? `${item.head_sha}...${green.head_sha}` : null; }).filter(Boolean))];
}

/** input {merges, runs [{name, event, branch, head_sha, conclusion, created_at, run_started_at, updated_at}], closedUnmerged [iso], bugs [iso]} -> one card per day (oldest first), the shape of admin/agent-coding.js cleanSdlc plus the day. */
export function computeSdlc(input, {days = 3, now = new Date()} = {}) {
  const from = new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10), today = now.toISOString().slice(0, 10), cards = new Map();
  const at = date => { if (!cards.has(date)) cards.set(date, emptyDay(date)); return cards.get(date); };
  for (let back = 0; back < days; back++) at(new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10));
  const inWindow = date => date >= from && date <= today;
  const merges = (input.merges || []).filter(item => inWindow(item.day));
  for (const merge of merges) {
    const phases = at(merge.day).phases;
    phases.merged++; phases.prCommits += merge.commits.length;
    if (hasNoSpec(merge)) phases.nospec++;
    if (/^revert/i.test(merge.title || '')) phases.reverts++;
    const areas = new Set(merge.files.filter(file => kindOfFile(file) === 'product').map(areaOf).filter(Boolean));
    const earlier = (input.merges || []).filter(other => other.pr !== merge.pr && other.day <= merge.day && other.day >= new Date(Date.parse(`${merge.day}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10));
    if (isFixPr(merge) && earlier.some(other => other.files.some(file => kindOfFile(file) === 'product' && areas.has(areaOf(file))))) phases.fixAfter++;
  }
  for (const when of input.closedUnmerged || []) if (inWindow(day(when))) at(day(when)).phases.unmerged++;
  for (const when of input.bugs || []) if (inWindow(day(when))) at(day(when)).bugs++;
  const timed = (input.runs || []).map(item => ({...item, layer: layerOf(item), when: Date.parse(item.created_at)})).filter(item => item.layer && ['success', 'failure', 'timed_out'].includes(item.conclusion));
  const prRuns = timed.filter(item => item.layer === 'pr'), greens = new Map();
  for (const item of timed.filter(entry => entry.conclusion === 'success' && entry.layer !== 'pr')) { const key = `${item.layer}|${item.name}`; greens.set(key, [...(greens.get(key) || []), {at: Date.parse(item.updated_at || item.created_at), sha: item.head_sha}]); }
  const mergeFixes = (input.merges || []).map(merge => ({at: Date.parse(merge.at || `${merge.day}T23:59:59Z`), subject: merge.title, files: merge.files, lines: 20}));
  for (const item of timed.filter(entry => inWindow(day(entry.created_at)))) {
    const check = (at(day(item.created_at)).layers[item.layer][item.name] ||= {runs: 0, fails: 0, secs: 0, catches: emptyCatches()});
    check.runs++; check.secs += seconds(item.run_started_at || item.created_at, item.updated_at);
    if (item.conclusion === 'success') continue;
    check.fails++;
    check.catches[item.layer === 'pr' ? prCatch(item, prRuns, input.compares) : catchOf({at: item.when, sha: item.head_sha}, greens.get(`${item.layer}|${item.name}`) || [], mergeFixes)]++;
    if (item.layer === 'main') at(day(item.created_at)).phases.redMain = 1;
  }
  return [...cards.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// ---- collecting the input (the only part that talks to GitHub and git) ----
/** Runs of one kind created in the window, 4-hour slices of 100 per page; `filter` is the query part after the event ("&branch=main"). Stops, and says so, when the shared rate limit is low. */
export function fetchRuns({repo, days, now, event, filter = '', lowWater = 300}) {
  const runs = [], start = Date.parse(`${new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10)}T00:00:00Z`), slice = 4 * 3600000;
  let calls = 0;
  for (let from = start; from < now.getTime(); from += slice) {
    const range = `${new Date(from).toISOString().slice(0, 19)}Z..${new Date(Math.min(from + slice - 1000, now.getTime())).toISOString().slice(0, 19)}Z`;
    for (let page = 1; ; page++) {
      if (calls++ % 25 === 0 && Number(run('gh', ['api', 'rate_limit', '--jq', '.resources.core.remaining']).trim()) < lowWater) { console.error('sdlc-stats: rate limit low, stopping with what is read'); return runs; }
      const list = gh(`repos/${repo}/actions/runs?event=${event}${filter}&created=${range}&per_page=100&page=${page}`).workflow_runs || [];
      for (const item of list) runs.push({name: item.name, event: item.event, branch: item.head_branch, head_sha: item.head_sha, conclusion: item.conclusion, created_at: item.created_at, run_started_at: item.run_started_at, updated_at: item.updated_at});
      if (list.length < 100) break;
    }
  }
  return runs;
}
/** The diff between each red commit and its green one -> {"red...green": {status, files, lines, subject}} (one GitHub compare call each; stops, and says so, when the shared limit is low). Only the class of the change is kept, never its text. */
export function fetchCompares(repo, pairs, lowWater = 300) {
  const out = {};
  for (const [index, pair] of pairs.entries()) {
    if (index % 25 === 0 && Number(run('gh', ['api', 'rate_limit', '--jq', '.resources.core.remaining']).trim()) < lowWater) { console.error('sdlc-stats: rate limit low, the rest of the reds are left as rebase'); break; }
    try { const diff = gh(`repos/${repo}/compare/${pair}`); out[pair] = {status: diff.status, files: (diff.files || []).map(file => file.filename), lines: (diff.files || []).reduce((n, file) => n + (file.additions || 0) + (file.deletions || 0), 0), subject: diff.commits?.at(-1)?.commit?.message?.split('\n')[0] || ''}; } catch { /* a commit GitHub no longer has: the red stays "rebase" */ }
  }
  return out;
}
const closedUnmerged = repo => gh(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`).filter(item => !item.merged_at).map(item => item.closed_at);
// Why (1 Nov 2026): "bug issues the people filed" = label bug and none of the machine labels (source:, auto-ui, kind:test-failure); a Sentry source is for later.
const bugIssues = repo => gh(`repos/${repo}/issues?state=all&labels=bug&since=${new Date(Date.now() - 15 * 86400000).toISOString()}&per_page=100`).filter(item => !item.pull_request && !item.labels.some(label => /^(source:|auto-ui|kind:)/.test(label.name))).map(item => item.created_at);

function main(argv) {
  const arg = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const days = Math.min(14, Math.max(1, Number(arg('--days')) || 3)), now = arg('--now') ? new Date(arg('--now')) : arg('--end') ? new Date(`${arg('--end')}T23:59:59Z`) : new Date(), repo = process.env.REPO || 'GarryOne/jobadabra';
  const input = arg('--input') ? JSON.parse(readFileSync(arg('--input'), 'utf8')) : {merges: fetchMerges({days, now}), closedUnmerged: closedUnmerged(repo), bugs: bugIssues(repo),
    runs: [...fetchRuns({repo, days, now, event: 'pull_request'}), ...fetchRuns({repo, days, now, event: 'push', filter: '&branch=main'}), ...fetchRuns({repo, days, now, event: 'schedule'}), ...fetchRuns({repo, days, now, event: 'workflow_dispatch'})]};
  if (!input.compares) input.compares = fetchCompares(repo, pendingPairs(input, {days, now}));
  if (arg('--save-input')) writeFileSync(arg('--save-input'), JSON.stringify(input));
  const cards = computeSdlc(input, {days, now});
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify({kind: 'sdlc', days: cards}));
  console.log(`sdlc-stats: ${cards.length} days, ${(input.merges || []).length} merges, ${(input.runs || []).length} runs`);
  return cards;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

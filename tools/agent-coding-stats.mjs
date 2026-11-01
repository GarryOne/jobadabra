#!/usr/bin/env node
// The CI side of /admin/operations/agent-coding (owner, 1 Nov 2026): per day, from GitHub and git only, the merged PRs and how many changed CI or tooling, what fixed each red (the first green commit after it),
// the fix PRs per area, and the CI minutes per push. Pure counting by structure (shas, paths, conclusions, timestamps, a title or branch word): no AI, no log text. Only counts and short area names are sent.
//   node tools/agent-coding-stats.mjs [--days 3] [--end 2026-11-01] [--out cards.json] [--input input.json --now 2026-11-01T12:00:00Z]
// Needs gh with GH_TOKEN and a full git history unless --input. --out writes the body agent-coding-stats.yml PUTs to /agent-coding/data (SELFHEAL_PUBLISH_KEY). Guard: desktop/test/agent-coding-stats.test.js.
// Input (what fetchInput collects, so a test needs no network): {runs: [{name, head_sha, conclusion, created_at, run_started_at, updated_at, pr}],
//   merges: [{pr, day, title, branch, files: [], commits: [{sha, subject, files: [], lines}]}]}  (commits of the PR, oldest first).
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Why (1 Nov 2026, owner: "changes CI or tooling"): the same three roots as the owner's hand count of 31 Oct (267 of 356 PRs).
export const CI_PATH = /^(\.github\/|tools\/|desktop\/e2e\/)/;
const TEST_DIRS = /^(tests?\/|desktop\/(test|e2e|integration)\/)/;
const PRODUCT_DIRS = /^(src|desktop|extension|worker|site|prompts)\//;
// Why (1 Nov 2026, pa's prune audit, about +-10 points): a fixing commit whose subject says it is about how a change is written down, and is small, is "form".
export const FORM_WORDS = /trailer|comment|baseline|ratchet|lint|prettier|format|\bcount\b|file size|split|wording|rename|typo|why-changed|recorded-unneeded|pool-row|prompt-case|spec[- ]proof|registry|stale|expectation|paths:|gitar|\bdocs?\b|re-?run|retrigger|bump|declare|unused/i;

// A changed file -> 'product' | 'test' | 'ci' (docs, workflows, tools, anything else counts as ci), by its path alone; never throws.
export const kindOfFile = file => (/^(docs\/|\.github\/|tools\/)/.test(file) || file.endsWith('.md') ? 'ci' : TEST_DIRS.test(file) ? 'test' : PRODUCT_DIRS.test(file) ? 'product' : 'ci');
// What a fixing commit was: 'product' | 'test' | 'ci' | 'form'.
export function classifyFix({subject = '', files = [], lines = 0}) {
  if (!files.length) return 'form';
  const kinds = new Set(files.map(kindOfFile));
  if (kinds.has('product') && lines > 6) return 'product';
  if (FORM_WORDS.test(subject) && lines <= 60) return 'form';
  if (kinds.has('product')) return 'product';
  if (kinds.size === 1 && kinds.has('test')) return 'test';
  return FORM_WORDS.test(subject) ? 'form' : 'ci';
}
// The first two folders of a product file: desktop/renderer/x.js -> desktop/renderer; extension/x.js -> extension.
export const areaOf = file => file.split('/').slice(0, -1).slice(0, 2).join('/');
// A merged PR (its title and branch) -> true when it says "fix" in either, the owner's own wording of a fix PR; false on missing text.
export const isFixPr = merge => /\bfix/i.test(merge.title || '') || /(^|\/)fix/i.test(merge.branch || '');

const minutes = (from, to) => Math.max(0, (Date.parse(to) - Date.parse(from)) / 60000) || 0;
const round = value => Math.round(value * 10) / 10;
const day = iso => String(iso).slice(0, 10);
const empty = date => ({day: date, prs: {merged: 0, ci: 0}, reds: {product: 0, test: 0, ci: 0, form: 0, nofix: 0}, fixPrs: {}, wall: [], queue: [], cancelledMin: 0});

// input -> one card per day of the window (oldest first), the shape of admin/agent-coding.js cleanCi plus the day.
export function compute(input, {days = 3, now = new Date()} = {}) {
  const from = new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10), cards = new Map();
  const at = date => { if (!cards.has(date)) cards.set(date, empty(date)); return cards.get(date); };
  for (let back = 0; back < days; back++) at(new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10));
  const inWindow = date => date >= from && date <= now.toISOString().slice(0, 10);
  const byPr = new Map((input.merges || []).map(merge => [merge.pr, merge]));
  // Why (1 Nov 2026, owner: the page showed no reds): a run of a merged PR no longer lists its pull request (0 of 29 measured), so the run's branch joins it to its merge.
  const byBranch = new Map();   // a branch name can be reused by a later PR: keep every merge and pick the one that holds the red's commit
  for (const merge of input.merges || []) byBranch.set(merge.branch, [...(byBranch.get(merge.branch) || []), merge]);
  for (const merge of (input.merges || []).filter(item => inWindow(item.day))) {
    const card = at(merge.day);
    card.prs.merged++;
    if (merge.files.some(file => CI_PATH.test(file))) card.prs.ci++;
    if (isFixPr(merge)) for (const area of new Set(merge.files.filter(file => kindOfFile(file) === 'product').map(areaOf).filter(Boolean))) card.fixPrs[area] = (card.fixPrs[area] || 0) + 1;
  }
  // A push = every pull-request run of one commit: its minutes added together, its wait for a runner = its slowest start.
  const pushes = new Map();
  for (const run of input.runs || []) {
    const push = pushes.get(run.head_sha) || {day: day(run.created_at), wall: 0, queue: 0};
    pushes.set(run.head_sha, push);
    push.day = push.day < day(run.created_at) ? push.day : day(run.created_at);
    const wall = minutes(run.run_started_at || run.created_at, run.updated_at);
    push.wall += wall; push.queue = Math.max(push.queue, minutes(run.created_at, run.run_started_at || run.created_at));
    if (run.conclusion === 'cancelled' && inWindow(day(run.created_at))) at(day(run.created_at)).cancelledMin += wall;
  }
  for (const push of pushes.values()) if (inWindow(push.day)) { at(push.day).wall.push(round(push.wall)); at(push.day).queue.push(round(push.queue)); }
  // A red on a merged PR: the first later commit of that PR whose run of the same workflow is green fixed it. Not on a merged PR, or its commit gone (force push): not seen.
  const green = new Set((input.runs || []).filter(run => run.conclusion === 'success').map(run => `${run.name}|${run.head_sha}`));
  for (const run of (input.runs || []).filter(item => ['failure', 'timed_out'].includes(item.conclusion) && inWindow(day(item.created_at)))) {
    const merge = byPr.get(run.pr) || (byBranch.get(run.branch) || []).find(item => item.commits.some(commit => commit.sha === run.head_sha)), at0 = merge ? merge.commits.findIndex(commit => commit.sha === run.head_sha) : -1;
    if (at0 < 0) continue;
    const fix = merge.commits.slice(at0 + 1).find(commit => green.has(`${run.name}|${commit.sha}`));
    at(day(run.created_at)).reds[fix ? classifyFix(fix) : 'nofix']++;
  }
  return [...cards.values()].sort((a, b) => a.day.localeCompare(b.day)).map(card => ({...card, cancelledMin: round(card.cancelledMin)}));
}

// ---- collecting the input (the only part that talks to GitHub and git) ----
const run = (command, args, options = {}) => execFileSync(command, args, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options});
const gh = path => JSON.parse(run('gh', ['api', path]));

// The merge commits of the window from the local git history (first parent of main) -> [{pr, day, title, branch, files, commits}] oldest commit first; `git` is a seam for tests.
export function fetchMerges({days, now, git = (...args) => run('git', args)}) {
  const since = new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const merges = [];
  for (const line of git('log', '--first-parent', '--merges', `--since=${since}T00:00:00Z`, `--until=${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}`, '--format=%H%x1f%cs%x1f%cI%x1f%s%x1f%b%x1e').split('\x1e')) {
    const [sha, date, at, subject, body] = line.trim().split('\x1f');
    const match = /^Merge pull request #(\d+) from \S+?\/(\S+)/.exec(subject || '');
    if (!match) continue;
    const commits = [];
    for (const block of git('log', '--reverse', '--numstat', '--format=%x1e%H%x1f%s', `${sha}^1..${sha}^2`).split('\x1e').slice(1)) {
      const [head, ...rest] = block.split('\n'), [csha, csubject] = head.split('\x1f'), files = [];
      let lines = 0;
      for (const stat of rest.filter(Boolean)) { const [add, del, ...name] = stat.split('\t'); if (name.length) { files.push(name.join('\t')); lines += (Number(add) || 0) + (Number(del) || 0); } }
      commits.push({sha: csha, subject: csubject, files, lines});
    }
    merges.push({pr: Number(match[1]), day: date, at, title: (body || '').split('\n')[0], branch: match[2], files: git('diff', '--name-only', `${sha}^1`, sha).split('\n').filter(Boolean), commits});
  }
  return merges;
}

// Every pull_request run created in the window, in 4-hour slices (GitHub lists at most 1000 per query); stops when the shared rate limit is low and says so.
export function fetchRuns({repo, days, now, lowWater = 300}) {
  const runs = [], start = Date.parse(`${new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10)}T00:00:00Z`), slice = 4 * 3600000;
  let calls = 0;
  for (let at = start; at < now.getTime(); at += slice) {
    const range = `${new Date(at).toISOString().slice(0, 19)}Z..${new Date(Math.min(at + slice - 1000, now.getTime())).toISOString().slice(0, 19)}Z`;
    for (let page = 1; ; page++) {
      if (calls++ % 25 === 0 && Number(run('gh', ['api', 'rate_limit', '--jq', '.resources.core.remaining']).trim()) < lowWater) { console.error('agent-coding-stats: rate limit low, stopping with what is read'); return runs; }
      const list = gh(`repos/${repo}/actions/runs?event=pull_request&created=${range}&per_page=100&page=${page}`).workflow_runs || [];
      for (const item of list) runs.push({name: item.name, head_sha: item.head_sha, conclusion: item.conclusion, created_at: item.created_at, run_started_at: item.run_started_at, updated_at: item.updated_at, pr: item.pull_requests?.[0]?.number ?? null, branch: item.head_branch ?? null});
      if (list.length < 100) break;
    }
  }
  return runs;
}

function main(argv) {
  const arg = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const days = Math.min(14, Math.max(1, Number(arg('--days')) || 3)), now = arg('--now') ? new Date(arg('--now')) : arg('--end') ? new Date(`${arg('--end')}T23:59:59Z`) : new Date();
  const input = arg('--input') ? JSON.parse(readFileSync(arg('--input'), 'utf8')) : {runs: fetchRuns({repo: process.env.REPO || 'GarryOne/jobadabra', days, now}), merges: fetchMerges({days, now})};
  const cards = compute(input, {days, now});
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify({kind: 'ci', days: cards}));
  console.log(`agent-coding-stats: ${cards.length} days, ${cards.reduce((n, card) => n + card.prs.merged, 0)} merged PRs, ${(input.runs || []).length} runs`);
  return cards;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

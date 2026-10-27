#!/usr/bin/env node
// Re-asks the "form" case set (tools/prompt-cases.json) with main's prompts and with the PR's, on Haiku 5.5 through Claude Code (`claude -p`) on the API key
// PR_PROOF_ANTHROPIC_KEY (its own workspace + spend limit). Why-changed (owner, 27 Oct 2026): asked "Use Haiku instead" he chose "Haiku on an API key (Recommended)" over
// the subscription token (earlier: "let them use my claude subscription" … "Haiku" … "very cheap"). Same cases on both sides: the PR's case list, so the case a PR adds is asked of main's prompt too.
// Cost: every call's total_cost_usd is added up and printed; past --max-usd it stops asking and fails ("cost cap"), never a silent pass.
// Fails when a case right on main is wrong on the PR twice (one re-ask: Haiku answers vary), or a case the PR adds is wrong on the PR's prompt.
// It catches prompt regressions, not model ones: Free AI users get qwen on Workers AI, not Haiku.
// Usage (prompt-cases.yml): node tools/prompt-cases-live.mjs --base-tree <a checkout of the merge base> [--jobs 6] [--max-calls 140] [--max-usd 0.10]   (needs PR_PROOF_ANTHROPIC_KEY)
// Writes nothing but stdout; exit 1 with the cases that broke. Guard: desktop/test/prompt-cases-live.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const MODEL = 'claude:claude-haiku-5-5';
export const MAX_USD = 0.10;   // Why (owner, 27 Oct 2026, "per-run $ cap"): measured on #2259: $0.044 for the 60-case set asked on both sides (120 calls), so the cap is ~2x
const CASE_FILES = ['tools/free-ai-form-asks.mjs', 'tools/free-ai-form-list.mjs'];

// [{id, right}] of main and of the PR, the case ids main's own list had, and the re-ask of the PR's misses -> {regressions, newWrong, counts}.
export function compare(base, head, baseIds, again = []) {
  const right = rows => new Map(rows.map(row => [row.id, row.right === true]));
  const onBase = right(base), onHead = right(head), retried = right(again);
  const regressions = head.filter(row => onBase.get(row.id) && !onHead.get(row.id) && retried.get(row.id) !== true).map(row => row.id);
  const newWrong = head.filter(row => !baseIds.includes(row.id) && !onHead.get(row.id) && retried.get(row.id) !== true).map(row => row.id);
  const count = map => [...map.values()].filter(Boolean).length;
  return {regressions, newWrong, counts: {cases: head.length, base: count(onBase), head: count(new Map([...onHead].map(([id, ok]) => [id, ok || retried.get(id) === true])))}};
}

// The case ids a re-ask needs: wrong on the PR and either right on main or new.
export const toRetry = (base, head, baseIds) => {
  const onBase = new Map(base.map(row => [row.id, row.right === true]));
  return head.filter(row => !row.right && (onBase.get(row.id) || !baseIds.includes(row.id))).map(row => row.id);
};

// Runs `task` over `items`, `jobs` at a time, keeping their order.
export async function pool(items, jobs, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(jobs, items.length)}, async () => { while (next < items.length) { const i = next++; out[i] = await task(items[i]); } }));
  return out;
}

/**
 * The node arguments that build a checkout's real-sized form cases (the demo profile: fictional data only).
 * @param {string} tree a checkout (main's merge base, or the PR's)
 * @param {string} out where the cases JSON goes
 * @returns {string[]} the script (by its real path: its run-as-script check compares it) and every option it requires
 */
export function caseArgs(tree, out) {
  return [fs.realpathSync(path.join(tree, 'tools/free-ai-form-cases.mjs')),
    '--profile', path.join(tree, 'desktop/demo/profile.md'), '--answers', path.join(tree, 'desktop/demo/answers.md'), '--set', 'real', '--out', out];
}

// The real-sized form cases a checkout builds with its own prompts (its tools/free-ai-form-cases.mjs).
function buildCases(tree) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-cases-')), 'cases.json');
  execFileSync('node', caseArgs(tree, out), {cwd: tree, stdio: ['ignore', 'ignore', 'inherit']});
  if (!fs.existsSync(out)) throw new Error(`${tree}: tools/free-ai-form-cases.mjs wrote no cases`);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

async function main(argv) {
  const option = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), baseTree = option('base-tree');
  if (!baseTree) throw new Error('--base-tree <a checkout of the merge base> is required');
  const jobs = Number(option('jobs', 6)), maxCalls = Number(option('max-calls', 140)), maxUsd = Number(option('max-usd', MAX_USD));
  const apiKey = process.env.PR_PROOF_ANTHROPIC_KEY;
  if (!apiKey) throw new Error('PR_PROOF_ANTHROPIC_KEY is not set: the prompt cases are not asked');
  const modules = path.join(baseTree, 'worker/node_modules');   // the worker's packages (its ai.js imports the SDK): the PR checkout's, linked
  if (!fs.existsSync(modules) && fs.existsSync(path.join(root, 'worker/node_modules'))) fs.symlinkSync(path.join(root, 'worker/node_modules'), modules, 'dir');
  const baseIds = buildCases(baseTree).map(item => item.id);
  for (const file of CASE_FILES) fs.copyFileSync(path.join(root, file), path.join(baseTree, file));   // main's prompts, the PR's case list
  const baseCases = buildCases(baseTree), headCases = buildCases(root);
  if (baseCases.length + headCases.length > maxCalls) throw new Error(`${baseCases.length + headCases.length} calls is over the cap of ${maxCalls}`);
  const {evaluate} = await import('./free-ai-eval.mjs');
  const {claudeRun} = await import('./free-ai-eval-claude.mjs');
  let spent = 0;
  const run = claudeRun({apiKey, onCost: usd => { spent += usd; }});
  const ask = async item => {
    if (spent > maxUsd) throw new Error(`cost cap reached: $${spent.toFixed(3)} spent, cap $${maxUsd}; the prompt cases are not fully asked`);
    return (await evaluate([item], MODEL, run))[0];
  };
  console.log(`Asking ${headCases.length} form cases of main's prompts and of this PR's on Haiku 5.5 (PR_PROOF_ANTHROPIC_KEY, cap $${maxUsd}), ${jobs} at a time.`);
  const [base, head] = [await pool(baseCases, jobs, ask), await pool(headCases, jobs, ask)];
  const retry = toRetry(base, head, baseIds).slice(0, Math.max(0, maxCalls - base.length - head.length));
  const again = await pool(headCases.filter(item => retry.includes(item.id)), jobs, ask);
  console.log(`Cost: $${spent.toFixed(3)} of the $${maxUsd} cap.`);
  const {regressions, newWrong, counts} = compare(base, head, baseIds, again);
  const why = id => (head.find(row => row.id === id)?.problems || [head.find(row => row.id === id)?.error || '']).join('; ').slice(0, 160);
  console.log(`Right on main's prompts: ${counts.base} of ${counts.cases}. On this PR's: ${counts.head} of ${counts.cases}.`);
  for (const id of regressions) console.log(`REGRESSION ${id}: right on main, wrong here twice: ${why(id)}`);
  for (const id of newWrong) console.log(`NEW CASE WRONG ${id}: the case this PR adds is not answered right by its prompt: ${why(id)}`);
  if (regressions.length || newWrong.length) return 1;
  console.log('No case got worse, and every new case is right.');
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main(process.argv.slice(2)).catch(error => { console.error(error.message); return 1; }));

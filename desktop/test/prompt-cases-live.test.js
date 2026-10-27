// The live re-ask of a prompt's case set (tools/prompt-cases-live.mjs, .github/workflows/prompt-cases.yml): main's prompts vs the PR's on the same cases, on Haiku 5.5
// through Claude Code on PR_PROOF_ANTHROPIC_KEY. The verdict logic and the workflow's wiring, with no AI call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {claudeRun} from '../../tools/free-ai-eval-claude.mjs';
import {caseArgs, compare, MAX_USD, MODEL, pool, toRetry} from '../../tools/prompt-cases-live.mjs';

const root = new URL('../../', import.meta.url);
const rows = map => Object.entries(map).map(([id, right]) => ({id, right}));

test('a case right on main and wrong on the PR is a regression only when its re-ask is wrong too (Haiku answers vary)', () => {
  const base = rows({a: true, b: true, c: false}), head = rows({a: true, b: false, c: false});
  assert.deepEqual(toRetry(base, head, ['a', 'b', 'c']), ['b'], 'a case wrong on both sides is not re-asked');
  assert.deepEqual(compare(base, head, ['a', 'b', 'c'], rows({b: false})).regressions, ['b']);
  assert.deepEqual(compare(base, head, ['a', 'b', 'c'], rows({b: true})).regressions, []);
});

test('a case the PR adds must be right on the PR\'s prompt; its answer on main does not matter', () => {
  const base = rows({a: true, n: false}), head = rows({a: true, n: false});
  assert.deepEqual(toRetry(base, head, ['a']), ['n']);
  assert.deepEqual(compare(base, head, ['a'], rows({n: false})).newWrong, ['n']);
  assert.deepEqual(compare(base, rows({a: true, n: true}), ['a']).newWrong, []);
});

// Why (#2223 review): a comment put mid-list swallowed --profile and --answers, so every case build threw before Haiku was asked; the unit tests never built a case.
test('the case build passes every option tools/free-ai-form-cases.mjs requires, each pointing at a file that exists', () => {
  const tree = fileURLToPath(root);
  const args = caseArgs(tree, '/x/cases.json');
  const required = [...fs.readFileSync(new URL('tools/free-ai-form-cases.mjs', root), 'utf8').matchAll(/need\('([a-z-]+)'\)/g)].map(found => found[1]);
  assert.ok(required.length >= 3, 'the builder still names its required options with need()');
  for (const name of required) {
    const at = args.indexOf(`--${name}`);
    assert.ok(at > 0 && args[at + 1], `--${name} is passed with a value`);
    if (name !== 'out') assert.ok(fs.existsSync(args[at + 1]), `--${name} ${args[at + 1]} exists`);
  }
});

test('the counts say how many cases each side gets right', () => {
  assert.deepEqual(compare(rows({a: true, b: false}), rows({a: true, b: false}), ['a', 'b'], rows({})).counts, {cases: 2, base: 1, head: 1});
});

test('the pool runs every item, at most `jobs` at once, in order', async () => {
  let running = 0, most = 0;
  const out = await pool([1, 2, 3, 4, 5], 2, async n => { running++; most = Math.max(most, running); await new Promise(r => setTimeout(r, 5)); running--; return n * 2; });
  assert.deepEqual(out, [2, 4, 6, 8, 10]); assert.equal(most, 2);
});

test('it asks Haiku 5.5 through Claude Code on PR_PROOF_ANTHROPIC_KEY (owner, 27 Oct 2026), never the subscription token or the production Workers AI token', () => {
  assert.equal(MODEL, 'claude:claude-haiku-5-5');
  const flow = fs.readFileSync(new URL('.github/workflows/prompt-cases.yml', root), 'utf8');
  assert.match(flow, /PR_PROOF_ANTHROPIC_KEY: \$\{\{ secrets\.PR_PROOF_ANTHROPIC_KEY \}\}/);
  assert.doesNotMatch(flow, /CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|workers_ai|CF_API_TOKEN/i);
  assert.ok(MAX_USD > 0 && MAX_USD <= 0.5, 'a per-run cost cap exists');
});

test('without the key the PR shows "prompt cases NOT run", never a silent green', () => {
  const flow = fs.readFileSync(new URL('.github/workflows/prompt-cases.yml', root), 'utf8');
  assert.match(flow, /Prompt cases NOT run: no API key \(PR_PROOF_ANTHROPIC_KEY\)/);
  assert.match(flow, /state=error/);
});

test('the key is the only credential Claude Code gets, its cost is reported, and a run past the cap stops asking', async () => {
  const seen = [], costs = [];
  const exec = async (file, args, options) => { seen.push(options.env); return JSON.stringify({result: 'ok', total_cost_usd: 0.004, usage: {}}); };
  const run = claudeRun({exec, apiKey: 'k-test', onCost: usd => costs.push(usd), env: {PATH: '/bin', ANTHROPIC_API_KEY: 'other', CLAUDE_CODE_OAUTH_TOKEN: 't', PR_PROOF_ANTHROPIC_KEY: 'k-test'}, cwd: '/e'});
  await run('claude:claude-haiku-5-5', {messages: [{role: 'system', content: 's'}, {role: 'user', content: 'u'}]});
  assert.deepEqual(costs, [0.004]);
  assert.equal(seen[0].ANTHROPIC_API_KEY, 'k-test');
  assert.equal(seen[0].CLAUDE_CODE_OAUTH_TOKEN, undefined, 'the plan sign-in is removed');
  assert.equal(seen[0].PR_PROOF_ANTHROPIC_KEY, undefined);
  const flow = fs.readFileSync(new URL('tools/prompt-cases-live.mjs', root), 'utf8');
  assert.match(flow, /cost cap reached/);
  assert.match(flow, /PR_PROOF_ANTHROPIC_KEY is not set/);
});

test('the workflow starts on every file of the live set: its prompts, its case files and the tools that build and ask them', () => {
  const flow = fs.readFileSync(new URL('.github/workflows/prompt-cases.yml', root), 'utf8');
  const {sets} = JSON.parse(fs.readFileSync(new URL('tools/prompt-cases.json', root), 'utf8'));
  const live = Object.values(sets).filter(set => set.live).flatMap(set => [...Object.keys(set.prompts), ...set.cases]);
  for (const file of [...live, 'tools/prompt-cases.mjs', 'tools/prompt-cases.json', 'tools/prompt-cases-live.mjs', 'tools/free-ai-form-cases.mjs', 'tools/free-ai-eval.mjs', 'tools/free-ai-eval-claude.mjs']) {
    assert.ok(flow.includes(`- '${file}'`), `prompt-cases.yml paths: ${file}`);
  }
});

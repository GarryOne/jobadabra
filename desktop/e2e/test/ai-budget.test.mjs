// The loop's AI budget breaker (ai-budget.mjs): a run that hit the provider's limit pauses the AI jobs for a few hours and tells the owner; a run that gets
// through clears it; every run's cost is read from claude-code-action's record. 3-4 Oct 2026: the loop hit the limit twice and kept starting jobs.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {budgetState, clear, outcome, shouldSkip, trip} from '../ai-budget.mjs';

const record = (result, extra = {}) => JSON.stringify([{type: 'system'}, {type: 'result', result, total_cost_usd: 0.42, num_turns: 9, ...extra}]);

test('a run\'s outcome: its cost and turns, and whether it was the provider\'s limit', () => {
  assert.deepEqual(outcome(record('done')), {usd: 0.42, turns: 9, error: '', limit: false});
  const limited = outcome(record('API Error: 400 You have reached your specified API usage limits. You will regain access on 2026-11-01', {is_error: true, total_cost_usd: 0, num_turns: 1}));
  assert.equal(limited.limit, true);
  assert.equal(outcome(record('API Error: 500 overloaded', {is_error: true})).limit, false, 'an outage is not the budget');
  assert.equal(outcome('not json').error, 'no execution record');
});

test('jobs skip while the breaker issue is open and recent, and try again after the pause', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  assert.equal(shouldSkip([{state: 'OPEN', updatedAt: '2026-10-04T10:00:00Z'}], now), true);
  assert.equal(shouldSkip([{state: 'OPEN', updatedAt: '2026-10-04T04:00:00Z'}], now), false, 'after six hours a job tries once');
  assert.equal(shouldSkip([], now), false);
});

test('tripping opens one issue (or adds to it), clearing closes it', () => {
  let issues = [];
  const calls = [];
  const gh = args => { calls.push(args); if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(issues); return ''; };
  trip({gh, job: 'fixer', error: 'usage limits'});
  assert.ok(calls.some(args => args[1] === 'create' && args.includes('ai-budget')));
  issues = [{number: 9, state: 'OPEN', createdAt: 'x'}];
  trip({gh, job: 'verdict', error: 'usage limits'});
  assert.ok(calls.some(args => args[1] === 'comment' && args[2] === '9'), 'a second trip adds to the same issue');
  clear({gh, job: 'code-review'});
  assert.ok(calls.some(args => args[1] === 'close' && args[2] === '9'));
});

// 4 Oct 2026: the cost file was written into the checkout, the fixer's guard took it for an edit outside the allowed folders and refused a good fix (#118).
test('recording a run\'s cost leaves the working folder untouched', async () => {
  const {execFileSync} = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-cwd-')), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-tmp-'));
  const record = path.join(temp, 'exec.json');
  fs.writeFileSync(record, JSON.stringify([{type: 'result', result: 'ok', total_cost_usd: 0.1, num_turns: 2}]));
  execFileSync(process.execPath, [new URL('../ai-budget.mjs', import.meta.url).pathname, '--after', record, '--job', 'fixer'], {cwd: work, env: {...process.env, RUNNER_TEMP: temp, GITHUB_OUTPUT: '', GH_TOKEN: ''}, stdio: 'pipe'});
  assert.deepEqual(fs.readdirSync(work), [], 'nothing written where the fixer\'s guard looks');
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'ai-cost.json'), 'utf8')).usd, 0.1);
});

test('the page is told when the AI pause is on, since when, until when and how many findings wait', () => {
  const issue = {number: 1654, state: 'OPEN', createdAt: '2026-10-21T02:11:00Z', body: 'x', comments: [{body: 'API Error: 400 You will regain access on 2026-11-01 at 00:00 UTC.'}]};
  assert.deepEqual(budgetState([issue], 8), {paused: true, issue: 1654, since: '2026-10-21', until: '2026-11-01', waiting: 8});
  assert.deepEqual(budgetState([{...issue, comments: []}], 3), {paused: true, issue: 1654, since: '2026-10-21', until: '', waiting: 3});
  assert.deepEqual(budgetState([], 8), {paused: false, issue: null, since: '', until: '', waiting: 0});
});

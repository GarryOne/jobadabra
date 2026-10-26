// When the pool's smoke may run on CI (owner: 11 Oct 2026 "by hand only"; 12 Oct 2026 also on a GitHub runner, by hand). 13 Oct 2026 (owner: "I don't want
// PR to generate an AI cost"): the PR live proof and the flow canary that called it were removed; it starts BY HAND only, and no pull request workflow can
// reach an AI key or the pool run. A new trigger, a caller or a PR workflow with an AI key fails here, with the workflow's name.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.github', 'workflows');
const workflows = Object.fromEntries(fs.readdirSync(DIR).filter(name => /\.ya?ml$/.test(name)).map(name => [name, fs.readFileSync(path.join(DIR, name), 'utf8')]));
export const triggersOf = text => [...(text.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] || '').matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]);

test('a workflow that records the pool sites starts by hand, plus the daily discovery batch and the daily watch list: never another schedule, a push, a call or a PR', () => {
  // A `paths:` entry naming a file (site-replays-pr.yml lists desktop/e2e/lib/record-sites.mjs, a library its replay imports) is not a run.
  const runs = text => text.split('\n').filter(line => !/^\s+- '[^']+'\s*$/.test(line)).join('\n');
  const runners = Object.keys(workflows).filter(name => /(^|[\s/'"])(smoke|record-sites)\.mjs\b|npm run (smoke|record-sites)\b/m.test(runs(workflows[name])));
  assert.deepEqual(runners, ['record-sites.yml', 'watch-live.yml']);   // the daily watch list records the same way (owner, 17 Oct 2026)
  assert.deepEqual(triggersOf(workflows['watch-live.yml']), ['schedule', 'workflow_dispatch']);
  assert.deepEqual([...workflows['watch-live.yml'].matchAll(/^ +- cron: '([^']+)'/gm)].map(match => match[1]), ['0 5 * * *'], 'one cron: the daily watch at 05:00 UTC');
  assert.deepEqual(triggersOf(workflows['record-sites.yml']), ['schedule', 'workflow_dispatch']);   // the schedule is the daily batch (owner, 17 Oct 2026)
  assert.deepEqual([...workflows['record-sites.yml'].matchAll(/^ +- cron: '([^']+)'/gm)].map(match => match[1]), ['0 6 * * *'], 'one cron: the daily batch at 06:00 UTC');
  const callers = Object.keys(workflows).filter(name => /uses: \.\/\.github\/workflows\/record-sites\.yml/.test(workflows[name]));
  assert.deepEqual(callers, [], 'no workflow calls the pool run');
});

// The class (owner, 13 Oct 2026): no workflow a pull request starts can spend AI: no AI key, no live pool run, no claude CLI.
test('no pull request workflow can reach an AI key or the live pool', () => {
  const onPr = Object.keys(workflows).filter(name => triggersOf(workflows[name]).some(t => t === 'pull_request' || t === 'pull_request_target'));
  assert.ok(onPr.length > 0, 'the reader finds the PR workflows (positive control)');
  for (const name of onPr) {
    assert.doesNotMatch(workflows[name], /secrets\.[A-Z_]*(ANTHROPIC|OPENAI)[A-Z_]*|secrets: inherit|record-sites\.yml|\bclaude -p\b/, `${name}: a PR workflow must not spend AI`);
  }
});

test('the trigger reader sees a trigger added to either file (positive control)', () => {
  const smoke = workflows['record-sites.yml'];
  assert.deepEqual(triggersOf(smoke.replace('on:\n', 'on:\n  push:\n    branches: [main]\n')), ['push', 'schedule', 'workflow_dispatch']);
});

// 12 Oct 2026: two dispatches in the same second, and GitHub's shared concurrency group cancelled the older pending one (Ocado). The queue never drops a run.
test('no pool run is dropped: no concurrency group (GitHub cancels a pending run in it); a queue step waits for earlier runs before anything else is read', () => {
  const smoke = workflows['record-sites.yml'];
  assert.doesNotMatch(smoke, /^\s*concurrency:/m, 'record-sites.yml: a concurrency group cancels a waiting run');
  const wait = smoke.indexOf('pool-ci-wait.mjs'), states = smoke.indexOf('pool-ci-state.mjs prepare');
  assert.ok(wait > 0 && wait < states, 'the queue step runs before the earlier runs\' states are read');
  assert.ok(Number(smoke.slice(smoke.indexOf('\n  smoke:')).match(/timeout-minutes: (\d+)/)?.[1]) >= 75, 'the job has time to wait its turn');
});

test('the pool run sets JP_APPLICANT (thin when started by hand)', () => {
  assert.match(workflows['record-sites.yml'], /^ +JP_APPLICANT: thin\b/m);
});

// 15 Oct 2026: no PR proof keeps a visit back any more: a by-hand recording may use the host's whole day (limit 2), and each visit says it is by hand.
test('the recording run names its visit kind (by hand) and keeps no visit back for a PR proof', () => {
  const smoke = workflows['record-sites.yml'];
  assert.match(smoke, /JOB_PILOTTO_VISIT_KIND: hand\b/);
  assert.doesNotMatch(smoke, /JOB_PILOTTO_SITE_RESERVE|pull_request|PR_PROOF/);
  assert.match(smoke, /JOB_PILOTTO_SITE_LIMIT: '2'/);
});

// Owner, 14 Oct 2026: the CI workflow's one job is recording, so its rows move /admin/form-filling/lab (main only, the narrow key); it sends no "proven live" record any more.
test('the recording run sends its ladder moves, endings and (main only) its rows with the narrow key, on that step only, never the site key', () => {
  const smoke = workflows['record-sites.yml'];
  const step = smoke.match(/- name: The ladder moves, the rows' endings[^\n]*\n(?: {8}.*\n)+/)?.[0] || '';
  assert.match(step, /REPLAYS_PUBLISH_KEY: \$\{\{ secrets\.REPLAYS_PUBLISH_KEY \}\}/);
  assert.match(step, /\[ "\$GITHUB_REF" = "refs\/heads\/main" \] && node desktop\/e2e\/pool-ci-rows\.mjs/);   // the rows' results, a run on main only
  assert.doesNotMatch(smoke, /pool-proven|proven live/i, 'a recording run proves nothing live: the fix verdict is offline');
  assert.match(step, /node desktop\/e2e\/pool-moves\.mjs/);   // the ladder moves, marked source ci (lib/ladder-moves.mjs)
  assert.match(step, /node desktop\/e2e\/pool-endings\.mjs/);   // each row's ending (lib/pool-endings.mjs)
  const keyed = [...smoke.matchAll(/- name: ([^\n]*)\n(?: {8}.*\n)*? {10}REPLAYS_PUBLISH_KEY: \$\{\{/g)].map(match => match[1].slice(0, 30));
  assert.deepEqual(keyed, ['Pick the day\'s sites (red when', 'The ladder moves, the rows\' en'], 'the narrow key sits on the batch\'s picker (reads the site\'s input) and on that one publish step');
  assert.doesNotMatch(smoke, /STATS_API_KEY|STATS_KEY|site\.api_key/);
});

// Owner, 12 Oct 2026 (cost safety): live CI has its own Anthropic key with its own limit; the Tests key until it exists. Every run reports its spend to /admin/intelligence/ai-cost.
test('the pool run passes its live keys to the engine rule (which picks one, else the Tests key, and names it), and reports its spend to /admin/intelligence/ai-cost without ever failing', () => {
  const smoke = workflows['record-sites.yml'];
  for (const name of ['E2E_ANTHROPIC_KEY', 'LIVE_POOL_ANTHROPIC_KEY']) assert.match(smoke, new RegExp(`\\b${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`), `${name} reaches the run; lib/engine.mjs picks one`);
  assert.doesNotMatch(smoke, /AI_KEY_NAME|secrets\.LIVE_ANTHROPIC_KEY/, 'the choice is the engine rule\'s alone (lib/engine.mjs liveKeyName)');
  const step = smoke.match(/- name: Report the run's AI spend[^\n]*\n(?: {8}.*\n)+/)?.[0] || '';
  assert.match(step, /if: always\(\)/);
  assert.match(step, /AI_COST_PUBLISH_KEY: \$\{\{ secrets\.AI_COST_PUBLISH_KEY \}\}/);
  assert.match(step, /AI_COST_JOB: pool-live/);
  assert.match(step, /node desktop\/e2e\/pool-ai-cost\.mjs[^\n]*&& node desktop\/e2e\/ai-cost-report\.mjs --job "\$AI_COST_JOB" --file[^\n]*\|\| true/);
});

// Owner, 17 Oct 2026 ("Everything daily"): the daily discovery batch. A picker job without AI, a recording job only when it found a candidate, $3 a calendar week, a PR for the new shapes that is never merged here.
test('the daily discovery batch: picker without AI, recording only after a pick, capped rows and dollars, a pool PR that never merges', () => {
  const smoke = workflows['record-sites.yml'], section = name => { const start = smoke.indexOf(`\n  ${name}:`), rest = smoke.slice(start + 1), end = rest.slice(rest.indexOf('\n')).search(/\n  [a-z-]+:\n/); return end < 0 ? rest : rest.slice(0, rest.indexOf('\n') + end); };
  const pick = section('pick'), record = section('smoke'), pr = section('pool-pr');
  assert.match(pick, /if: github\.event_name == 'schedule'/);
  assert.doesNotMatch(pick, /ANTHROPIC|OPENAI|claude -p|xvfb|playwright/i, 'the picker spends nothing and opens no browser');
  assert.match(record, /needs: pick/);
  assert.match(record, /needs\.pick\.result == 'success' && needs\.pick\.outputs\.count != '0'/, 'no new candidate, no recording run');
  assert.match(record, /MAX_ROWS: \$\{\{ github\.event_name == 'schedule' && '5' \|\| '3' \}\}/, 'five rows a day at most');
  assert.match(record, /MAX_USD: \$\{\{ github\.event_name == 'schedule' && needs\.pick\.outputs\.max_usd \|\| '0\.50' \}\}/, 'the day\'s dollars come from the week\'s remainder');
  assert.match(record, /JOB_PILOTTO_SITE_LIMIT: '2'/, 'the site limit is the same');
  assert.match(record, /JP_APPLICANT: thin/, 'the test applicant, never the owner\'s');
  assert.doesNotMatch(pr, /ANTHROPIC|OPENAI|REPLAYS_PUBLISH_KEY/);
  assert.doesNotMatch(smoke, /gh pr merge|--auto|auto-merge/i, 'the owner merges every PR by hand');
  assert.match(pr, /needs: smoke/);
  assert.match(pr, /gh pr create/);
  const weekCap = fs.readFileSync(path.join(DIR, '..', '..', 'desktop', 'e2e', 'lib', 'discovery-pick.mjs'), 'utf8');
  assert.match(weekCap, /WEEK_CAP_USD = 3\b/);
  assert.match(weekCap, /MAX_ROWS = 5\b/);
});

test('the daily watch list: picker without AI, recording only when the month has room, its own $25 cap, never Submit, never merges, shares the site ledger and the queue', () => {
  const watch = workflows['watch-live.yml'], section = name => { const start = watch.indexOf(`\n  ${name}:`), rest = watch.slice(start + 1), end = rest.slice(rest.indexOf('\n')).search(/\n  [a-z-]+:\n/); return end < 0 ? rest : rest.slice(0, rest.indexOf('\n') + end); };
  const pick = section('pick'), record = section('smoke');
  assert.doesNotMatch(pick, /ANTHROPIC|OPENAI|claude -p|xvfb|playwright|TEST_ACCOUNTS/i, 'the picker spends nothing, opens no browser, sees no account');
  assert.match(record, /needs: pick/);
  assert.match(record, /needs\.pick\.outputs\.count != '0'/, 'at the cap: no run');
  assert.match(record, /MAX_USD: \$\{\{ needs\.pick\.outputs\.max_usd \}\}/);
  assert.match(record, /JOB_PILOTTO_SITE_LIMIT: '2'/, 'at most 2 visits a host a day');
  assert.match(record, /JP_APPLICANT: thin/);
  assert.match(record, /JP_TEST_ACCOUNTS: \$\{\{ secrets\.POOL_TEST_ACCOUNTS \}\}/, 'test accounts only, from the secret');
  assert.match(record, /AI_COST_JOB: pool-watch/, 'its spend has its own line on /admin/intelligence/ai-cost');
  assert.match(record, /POOL_WAIT_WORKFLOWS: record-sites\.yml,watch-live\.yml/, 'one pool run at a time across both');
  assert.match(record, /for workflow in record-sites\.yml watch-live\.yml/, 'the site ledger counts both workflows');
  assert.match(workflows['record-sites.yml'], /for workflow in record-sites\.yml \S+ watch-live\.yml/, 'and the batch counts the watch');
  assert.doesNotMatch(watch, /gh pr (merge|create)|--auto|auto-merge|concurrency:/i);
  assert.doesNotMatch(watch, /REPLAYS_PUBLISH_KEY|pool-ci-rows/, 'it writes nothing to the lab page itself');
  const lib = fs.readFileSync(path.join(DIR, '..', '..', 'desktop', 'e2e', 'lib', 'watch-list.mjs'), 'utf8');
  assert.match(lib, /MONTH_CAP_USD = 25\b/);
});

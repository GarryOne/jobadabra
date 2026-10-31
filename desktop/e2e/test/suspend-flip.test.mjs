// A same-commit retry flip proposes suspension with evidence and an owner; the default CLI is read-only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {entryProblems} from '../../../tools/lanes-check.mjs';

const tool = new URL('../../../tools/suspend-flip.mjs', import.meta.url);
const fixture = new URL('./fixtures/suspend-flip-reconstructed.json', import.meta.url);
const sharded = new URL('./fixtures/suspend-flip-sharded.json', import.meta.url);
const data = () => JSON.parse(fs.readFileSync(fixture, 'utf8'));
const options = {registry: {suites: {}}, suites: ['settings', 'apply'], owner: 'e2e-owner', since: '2026-10-28'};
async function proposals(attempts, overrides = {}) {
  assert.ok(fs.existsSync(tool), 'the suspension tool must exist');
  const {suspensions} = await import(tool);
  return suspensions({attempts, ...options, ...overrides});
}

test('labelled reconstructed same-sha red then green yields a valid suspension and owner issue', async () => {
  assert.match(data().provenance, /Reconstructed/);
  const out = await proposals(data().attempts);
  assert.equal(out.length, 1);
  const {suite, entry, issue} = out[0];
  assert.equal(suite, 'settings');
  assert.deepEqual(entryProblems(entry), []);
  assert.equal(entry.lane, 'suspended');
  assert.equal(entry.input, 'same-commit flip');
  assert.equal(entry.owner, 'e2e-owner');
  assert.equal(entry.since, options.since);
  for (const text of [entry.why, issue.body]) {
    assert.match(text, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    assert.match(text, /9001\/attempts\/1/);
    assert.match(text, /9001\/attempts\/2/);
  }
  assert.match(issue.title, /Suspend settings/);
  assert.match(issue.body, /same-commit flip across run attempts/);
  assert.match(issue.body, /this check does not protect you now/);
  assert.match(issue.body, /e2e-owner/);
  assert.match(issue.body, /next 3 main runs/);
  assert.match(issue.body, /fix PR/);
  assert.ok(issue.body.split('Proposed registry entry:')[0].includes(entry.returns));
});

for (const kind of ['red-red', 'different-sha', 'different-suite', 'green-red', 'same-attempt', 'different-run', 'incomplete-green']) {
  test(`${kind} is not a retry flip`, async () => {
    const {attempts} = data(), first = attempts[0].jobs[0], last = attempts[1].jobs[0];
    if (kind === 'red-red') last.conclusion = 'failure';
    if (kind === 'different-sha') last.head_sha = 'b'.repeat(40);
    if (kind === 'different-suite') last.name = 'apply';
    if (kind === 'green-red') { first.conclusion = 'success'; last.conclusion = 'failure'; }
    if (kind === 'same-attempt') last.run_attempt = 1;
    if (kind === 'different-run') last.run_id = 9002;
    if (kind === 'incomplete-green') last.status = 'in_progress';
    assert.deepEqual(await proposals(attempts), []);
  });
}

test('already listed lanes and duplicate evidence never add a suite twice', async () => {
  const {attempts} = data();
  for (const lane of ['suspended', 'tolerant', 'retired']) {
    assert.deepEqual(await proposals(attempts, {registry: {suites: {settings: {lane}}}}), []);
  }
  assert.equal((await proposals([...attempts, ...attempts].reverse())).length, 1);
});

test('ceiling-only entries still allow suspension; entries with a lane stay alone', async () => {
  const registry = {suites: {settings: {aiMissesMax: 0}}};
  const found = await proposals(data().attempts, {registry});
  assert.deepEqual(found.map(item => item.suite), ['settings']);
  assert.equal(found[0].entry.lane, 'suspended');
  for (const lane of ['suspended', 'tolerant', 'retired']) {
    registry.suites.settings.lane = lane;
    assert.deepEqual(await proposals(data().attempts, {registry}), []);
  }
});

test('a shard staying red prevents a suite green; non-suite plan jobs never become suspensions', async () => {
  const {attempts} = data();
  for (const attempt of attempts) {
    attempt.jobs[0].name = 'settings-1of2';
    attempt.jobs.push({...attempt.jobs[0], id: attempt.jobs[0].id + 10, name: 'settings-2of2', conclusion: 'failure'});
  }
  assert.deepEqual(await proposals(attempts), []);
  attempts[1].jobs[1].conclusion = 'success';
  assert.equal((await proposals(attempts)).length, 1);
  for (const attempt of attempts) for (const job of attempt.jobs) job.name = 'plan';
  assert.deepEqual(await proposals(attempts), []);
});

test('default and explicit dry-run print entries and issues without editing the registry or calling gh', () => {
  assert.ok(fs.existsSync(tool), 'the suspension tool must exist');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suspend-flip-'));
  try {
    const registry = path.join(dir, 'lanes.json'), original = JSON.stringify({suites: {}});
    fs.writeFileSync(registry, original);
    for (const extra of [[], ['--dry-run']]) {
      const run = spawnSync(process.execPath, [tool.pathname, '--attempts', fixture.pathname, '--registry', registry, '--owner', options.owner, ...extra], {encoding: 'utf8', env: {...process.env, PATH: dir}});
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /"lane": "suspended"/);
      assert.match(run.stdout, /"owner": "e2e-owner"/);
      assert.match(run.stdout, /this check does not protect you now/);
      assert.equal(fs.readFileSync(registry, 'utf8'), original);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('rerunning only failed shards uses the unchanged successful shards, never forgets an unrerun failure', async () => {
  const {attempts} = data();
  for (const attempt of attempts) attempt.jobs[0].name = 'settings-1of2';
  attempts[0].jobs.push({...attempts[0].jobs[0], id: 103, name: 'settings-2of2', conclusion: 'failure'});
  assert.deepEqual(await proposals(attempts), [], 'shard 2 remains red');
  attempts[0].jobs[1].conclusion = 'success';
  assert.equal((await proposals(attempts)).length, 1, 'only failed shard 1 needed a re-run');
});

test('partial shard evidence cannot say the whole suite passed', async () => {
  const {attempts} = data();
  for (const attempt of attempts) attempt.jobs[0].name = 'settings-1of2';
  assert.deepEqual(await proposals(attempts), []);
});

test('a suspension without a named owner is refused', async () => {
  await assert.rejects(() => proposals(data().attempts, {owner: ''}), /named.*owner/);
});

test('two sharded attempts propose one issue; a third attempt never duplicates an open suite issue', async () => {
  const attempts = JSON.parse(fs.readFileSync(sharded, 'utf8')).attempts;
  assert.equal((await proposals(attempts)).length, 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suspend-open-'));
  try {
    // Only gh is replaced: the real CLI reads the fixture, detects the flip and decides whether to create.
    fs.writeFileSync(path.join(dir, 'gh'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname, 'issues.json'), args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify(args) + '\\n');
if (args[0] !== 'issue') process.exit(2);
if (args[1] === 'list') {
  if (process.env.FAIL_LIST) process.exit(1);
  console.log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[]');
} else if (args[1] === 'create') {
  const issues = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
  issues.push({number: issues.length + 1, title: args[args.indexOf('--title') + 1]});
  fs.writeFileSync(file, JSON.stringify(issues));
} else process.exit(2);
`, {mode: 0o755});
    const registry = path.join(dir, 'lanes.json'), input = path.join(dir, 'attempts.json');
    const original = JSON.stringify({suites: {}});
    fs.writeFileSync(registry, original);
    const invoke = (extra = [], env = {}) => spawnSync(process.execPath, [tool.pathname, '--attempts', input, '--registry', registry,
      '--owner', options.owner, '--open', '--repo', 'example/fixture', ...extra], {encoding: 'utf8', env: {...process.env, PATH: dir, ...env}});
    fs.writeFileSync(input, JSON.stringify({attempts}));
    const first = invoke();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'issues.json'))).length, 1);
    attempts.push(...attempts.slice(2).map(page => ({...page, jobs: page.jobs.map(job => ({...job, id: job.id + 100, run_attempt: 3}))})));
    fs.writeFileSync(input, JSON.stringify({attempts}));
    const third = invoke();
    assert.equal(third.status, 0, third.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'issues.json'))).length, 1);
    assert.match(third.stdout, /already.*open/i);
    // A suite-level duplicate must be found even when the proposal names a different commit.
    for (const page of attempts) for (const job of page.jobs) job.head_sha = 'b'.repeat(40);
    fs.writeFileSync(input, JSON.stringify({attempts}));
    const otherCommit = invoke();
    assert.equal(otherCommit.status, 0, otherCommit.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'issues.json'))).length, 1);
    assert.match(otherCommit.stdout, /already.*open/i);
    const calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(calls.some(args => args[1] === 'list' && args.includes('--state') && args.includes('open')));
    const unavailable = invoke([], {FAIL_LIST: '1'});
    assert.notEqual(unavailable.status, 0, 'unreadable issues must never authorize a duplicate');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'issues.json'))).length, 1);
    assert.equal(fs.readFileSync(registry, 'utf8'), original);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// A step red on code unchanged since it passed ("same code, different result") proposes a step-level suspension and an owner issue; it never edits the registry (spec row 33, a8, 31 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {stepEntryProblems} from '../../../tools/lanes-check.mjs';
import {issueTitle, suspensions} from '../../../tools/suspend-flip.mjs';

const tool = new URL('../../../tools/suspend-flip.mjs', import.meta.url);
const READ = '"See which jobs can apply automatically" reads a job\'s form in the hidden browser: You review and submit, the tab closes, and nothing is filled or sent';
const verdict = (over = {}) => ({suite: 'apply', step: READ, verdict: 'flaky', redSha: 'fb1d711b0b43af12905b4e71b8b75b55b59e7726', redUrl: 'https://github.com/o/r/actions/runs/41200878403',
  green: {sha: '79e6c34aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', run: 41199890591, url: 'https://github.com/o/r/actions/runs/41199890591'}, message: "the suite's 11-minute budget ran out during this step", movedFiles: 6, stepFileCount: 814, ...over});
const options = {registry: {suites: {}}, owner: 'e2e-owner', since: '2026-10-31'};

test('a flaky verdict yields a valid step entry (lane, owner, why, returns) and an owner issue holding the evidence', () => {
  const [found] = suspensions({verdicts: [verdict()], ...options});
  assert.equal(found.suite, 'apply');
  assert.equal(found.step, READ);
  assert.deepEqual(stepEntryProblems({...found.entry, issue: 'https://github.com/o/r/issues/1'}), [], 'the entry is complete once it has its issue URL');
  assert.equal(found.entry.lane, 'suspended');
  assert.equal(found.entry.owner, 'e2e-owner');
  for (const text of [found.entry.why, found.issue.body]) {
    assert.match(text, /fb1d711/);
    assert.match(text, /79e6c34/);
    assert.match(text, /none of the 814 files it runs changed between them/);
  }
  assert.match(found.issue.body, /actions\/runs\/41200878403/, 'the red run');
  assert.match(found.issue.body, /actions\/runs\/41199890591/, 'the green run');
  assert.match(found.issue.body, /11-minute budget ran out/, "the step's failure text");
  assert.match(found.issue.body, /does not protect you now/);
  assert.match(found.issue.body, /next 3 main runs/);
  assert.match(found.issue.body, /never this one step, never a re-run/);
  assert.equal(found.issue.title, issueTitle('apply', READ));
  assert.ok(found.issue.title.length < 130);
});

test('only a flaky verdict proposes: changed is a regression, unknown has no evidence, and a step already listed is left alone', () => {
  assert.deepEqual(suspensions({verdicts: [verdict({verdict: 'changed'}), verdict({verdict: 'unknown'})], ...options}), []);
  const registry = {steps: {apply: {[READ]: {lane: 'suspended'}}}};
  assert.deepEqual(suspensions({verdicts: [verdict()], ...options, registry}), []);
  assert.equal(suspensions({verdicts: [verdict(), verdict()], ...options}).length, 1, 'the same step reported twice is one proposal');
  assert.equal(suspensions({verdicts: [verdict(), verdict({step: 'another step'})], ...options}).length, 2);
});

test('a green on the very same commit says so', () => {
  const [found] = suspensions({verdicts: [verdict({green: {sha: verdict().redSha, run: 1, url: 'https://x/1'}})], ...options});
  assert.match(found.entry.why, /that is the same commit/);
  assert.match(found.issue.body, /green ran on the very same commit/);
});

test('a suspension without a named owner is refused', () => {
  assert.throws(() => suspensions({verdicts: [verdict()], ...options, owner: ''}), /named.*owner/);
});

test('default and explicit dry-run print the entry and the issue without editing the registry or calling gh', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suspend-flip-'));
  try {
    const registry = path.join(dir, 'lanes.json'), recorded = path.join(dir, 'verdicts.json'), original = JSON.stringify({suites: {}});
    fs.writeFileSync(registry, original);
    fs.writeFileSync(recorded, JSON.stringify([verdict()]));
    for (const extra of [[], ['--dry-run']]) {
      const run = spawnSync(process.execPath, [tool.pathname, '--verdicts', recorded, '--registry', registry, '--owner', 'e2e-owner', ...extra], {encoding: 'utf8', env: {...process.env, PATH: dir}});
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /"lane": "suspended"/);
      assert.match(run.stdout, /"owner": "e2e-owner"/);
      assert.match(run.stdout, /does not protect you now/);
      assert.equal(fs.readFileSync(registry, 'utf8'), original);
    }
    const none = spawnSync(process.execPath, [tool.pathname, '--verdicts', recorded, '--registry', registry, '--owner', 'e2e-owner'], {encoding: 'utf8', env: {...process.env, PATH: dir}});
    assert.equal(none.status, 0);
    fs.writeFileSync(recorded, JSON.stringify([verdict({verdict: 'changed'})]));
    assert.match(spawnSync(process.execPath, [tool.pathname, '--verdicts', recorded, '--registry', registry, '--owner', 'e2e-owner'], {encoding: 'utf8'}).stdout, /No step is red on unchanged code/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('--open creates one issue per step, never a duplicate while one is open, and never when the issue list cannot be read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suspend-open-'));
  try {
    // Only gh is replaced: the real CLI reads the recorded verdicts and decides whether to create.
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
  issues.push({number: issues.length + 1, title: args[args.indexOf('--title') + 1], url: 'https://github.com/example/fixture/issues/' + (issues.length + 1)});
  fs.writeFileSync(file, JSON.stringify(issues));
  console.log(issues.at(-1).url);
} else process.exit(2);
`, {mode: 0o755});
    const registry = path.join(dir, 'lanes.json'), recorded = path.join(dir, 'verdicts.json'), original = JSON.stringify({suites: {}});
    fs.writeFileSync(registry, original);
    fs.writeFileSync(recorded, JSON.stringify([verdict()]));
    const invoke = (env = {}) => spawnSync(process.execPath, [tool.pathname, '--verdicts', recorded, '--registry', registry, '--owner', 'e2e-owner', '--open', '--repo', 'example/fixture'],
      {encoding: 'utf8', env: {...process.env, PATH: dir, ...env}});
    const first = invoke();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Opened https:\/\/github\.com\/example\/fixture\/issues\/1/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'issues.json'))).length, 1);
    const again = invoke();
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already open/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'issues.json'))).length, 1);
    const unavailable = invoke({FAIL_LIST: '1'});
    assert.notEqual(unavailable.status, 0, 'unreadable issues must never authorize a duplicate');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'issues.json'))).length, 1);
    assert.equal(fs.readFileSync(registry, 'utf8'), original, 'the registry is edited by a PR, never by this tool');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

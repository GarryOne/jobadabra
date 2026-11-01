// The merged commit-message check (tools/commit-checks.mjs): seven checks run together, one push lists every refusal, the push hook runs it before its slow gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CHECKS, listRefusals} from '../../tools/commit-checks.mjs';

const root = new URL('../../', import.meta.url);

test('every refusal is listed together, numbered, with its check name', () => {
  assert.equal(listRefusals([]), '');
  const text = listRefusals([{name: 'rung trailer', text: 'needs Rung\n'}, {name: 'why comments', text: 'needs Why-changed'}]);
  assert.match(text, /refused by 2 commit checks/);
  assert.match(text, /\[1\/2\] rung trailer\nneeds Rung/);
  assert.match(text, /\[2\/2\] why comments\nneeds Why-changed/);
  assert.match(listRefusals([{name: 'spec proof', text: 'x'}]), /refused by 1 commit check:/);
});

test('every check is a tool of the repo, and none of the dropped trailers is asked any more', () => {
  for (const [name, file] of CHECKS) assert.ok(fs.existsSync(new URL(`tools/${file}`, root)), `${name}: tools/${file}`);
  const files = CHECKS.map(([, file]) => file);
  assert.ok(!files.includes('owner-report.mjs') && !files.includes('prompt-cases.mjs'), 'Owner-report and Prompt-case are not push requirements (owner, 1 Nov 2026)');
});

test('the push hook runs them as one step, before the slow gates and before a PR push stops', () => {
  const hook = fs.readFileSync(new URL('tools/pre-push-check.sh', root), 'utf8');
  const at = hook.indexOf('node tools/commit-checks.mjs --base origin/main');
  assert.ok(at > 0, 'tools/pre-push-check.sh runs tools/commit-checks.mjs');
  assert.ok(at < hook.indexOf('case "$command" in *SHIP_PR=1*|*CI_GATES=1*)'), 'before the line where a PR push stops');
  assert.ok(at < hook.indexOf('gate_run() {'), 'before the journey and ladder gates');
  for (const [, file] of CHECKS) assert.ok(!hook.includes(`node tools/${file} --base`), `${file} runs only through commit-checks.mjs`);
});

test('a push with no changes passes all of them, and --skip drops one by name', () => {
  const run = args => spawnSync(process.execPath, ['tools/commit-checks.mjs', '--base', 'HEAD', ...args], {cwd: fileURLToPath(root), encoding: 'utf8'});
  assert.equal(run([]).status, 0, run([]).stderr);
  assert.equal(run(['--skip', 'e2e issue links,spec proof']).status, 0);
});

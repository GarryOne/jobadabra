// apply-verdict.sh: one verdict -> the comment, labels and closing the stats read, the same for the CI verdict pass and the triage-github-open-issues skill. gh is a fake that records its calls.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../apply-verdict.sh', import.meta.url));

function run(verdict, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-verdict-'));
  const log = path.join(dir, 'gh.log');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash\nall="$*"; printf '%s\\n' "\${all//$'\\n'/ }" >> "${log}"\n`, {mode: 0o755});
  fs.writeFileSync(path.join(dir, 'verdict.md'), verdict);
  const out = execFileSync(SCRIPT, ['42', path.join(dir, 'verdict.md'), 'o/r'], {encoding: 'utf8', env: {...process.env, PATH: `${dir}:${process.env.PATH}`, ...env}});
  return {out, calls: fs.readFileSync(log, 'utf8').trim().split('\n')};
}

test('a false positive is closed as not planned with its resolution label', () => {
  const {out, calls} = run('false-positive\nWhy: the list is two different jobs, not a duplicate.\nCause: detector\n');
  assert.equal(out.trim().split('\n').at(-1), '#42: false-positive');
  assert.ok(calls.some(line => line === 'issue edit 42 --repo o/r --add-label wontfix-auto'));
  assert.ok(calls.some(line => line === 'issue edit 42 --repo o/r --add-label resolution:fp:detector'));
  assert.ok(calls.some(line => line.startsWith('issue close 42 --repo o/r --reason not planned --comment <!-- ui-loop-verdict:false-positive -->')));
});

test('a fixed one is closed as completed with resolution:fixed; a triage session names itself in the footer', () => {
  const {calls} = run('fixed\nWhy: the card read the wrong field; fixed in abc1234 (desktop/e2e/apply-verdict.sh:1).\nSeverity: medium\n', {JUDGE: 'triage session'});
  assert.ok(calls.some(line => line.endsWith('--add-label resolution:fixed')));
  const close = calls.find(line => line.startsWith('issue close 42 --repo o/r --reason completed'));
  assert.match(close, /ui-loop-verdict:fixed/);
  assert.match(close, /UI loop · triage session · #42/);
});

test('a fixed verdict sets its Severity too, like a real one (12 Oct 2026: #360 judged high stayed medium)', () => {
  for (const word of ['real', 'fixed']) {
    const {calls} = run(`${word}\nWhy: the card read the wrong field; fixed in abc1234 (desktop/e2e/apply-verdict.sh:1).\nSeverity: high\n`);
    assert.ok(calls.some(line => line.startsWith('issue view 42 --json body,labels')), `${word}: its severity was not read`);
  }
});

test('a real one is confirmed and commented, never closed; an unknown word is parked for a person', () => {
  const real = run('real\nWhy: the button does nothing (desktop/e2e/apply-verdict.sh:1).\nSeverity: high\n').calls;
  assert.ok(real.includes('issue edit 42 --repo o/r --add-label confirmed'));
  assert.ok(!real.some(line => line.startsWith('issue close')));
  const parked = run('maybe\nWhy: cannot tell.\n').calls;
  assert.ok(parked.includes('issue edit 42 --repo o/r --add-label needs-human'));
  assert.ok(!parked.some(line => line.startsWith('issue close')));
});

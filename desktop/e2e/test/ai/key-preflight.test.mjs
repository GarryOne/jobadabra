// The gate's one-line AI key check (key-preflight.mjs): no key (a fork) passes without any call; the script is what the workflow's "AI key ready?" job runs.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

test('without a key the check passes and says why', () => {
  const run = spawnSync(process.execPath, [new URL('../../key-preflight.mjs', import.meta.url).pathname], {env: {PATH: process.env.PATH, E2E_ANTHROPIC_KEY: ''}, encoding: 'utf8'});
  assert.equal(run.status, 0);
  assert.match(run.stdout, /nothing to check/);
});

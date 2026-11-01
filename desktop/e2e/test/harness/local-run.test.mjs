// No whole e2e suite on the owner's Mac (lib/local-run.mjs; docs/rules/change-loop.md rule 7): CI runs the suites on every PR; locally a filtered step, the live run or a full run by choice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {localRunRefused} from '../../lib/local-run.mjs';

test('a whole suite on the Mac is refused and says what to do instead', () => {
  // 12 Oct 2026: a session ran two whole suites (applycv + apply) under the heavy lock while two sessions queued proofs behind it; rule 7 still said "run the suites locally".
  const why = localRunRefused({});
  assert.match(why, /CI runs the suites on your PR/);
  assert.match(why, /E2E_STEPS=/, 'names the filtered way');
  assert.match(why, /JP_E2E_FULL=1/, 'names the owner\'s choice');
});

test('a filtered step, the live run, a full run by choice and CI itself pass', () => {
  for (const env of [{E2E_STEPS: 'wizard-opens'}, {LIVE: '1'}, {JP_E2E_FULL: '1'}, {CI: 'true'}, {GITHUB_ACTIONS: 'true'}]) assert.equal(localRunRefused(env), '', JSON.stringify(env));
  assert.notEqual(localRunRefused({E2E_STEPS: '  '}), '', 'an empty filter is no filter');
});

test('run-all.mjs asks before it takes the heavy lock, and only when run as a script', () => {
  const source = fs.readFileSync(new URL('../../run-all.mjs', import.meta.url), 'utf8');
  const ask = source.indexOf('localRunRefused('), lock = source.indexOf("heavy('e2e-all'");
  assert.ok(ask > 0 && ask < lock, 'refused before the lock is taken (nobody queues behind a refused run)');
  assert.match(source.slice(source.lastIndexOf('\n', ask), ask + 200), /import\.meta\.url/, 'a unit test that imports run-all.mjs is not refused');
});

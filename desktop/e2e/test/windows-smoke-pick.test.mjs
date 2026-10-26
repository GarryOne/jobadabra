// A pull request that changes CI plumbing or shell runs one short Windows check (PR 3 of the PR-checks plan; owner's yes, 26 Oct 2026): beta 40261885119 found
// Git Bash's tar reading "D:\a\_temp\..." as a host only after #1997 merged (all 19 Windows suites red at the relay step); no PR check ran on Windows.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {windowsSmoke, WINDOWS_SMOKE} from '../lib/pr-suites.mjs';

test('CI plumbing and the shell CI runs start the Windows check; app code and Mac-only scripts do not', () => {
  const ci = 'run: bash lock-tools/tools/e2e-lock.sh acquire\nrun: node scripts/stage.mjs --app && scripts/python.sh   # desktop/scripts/python.sh';
  for (const file of ['.github/actions/free-ai-relay/action.yml', '.github/workflows/e2e.yml', 'tools/e2e-lock.sh', 'desktop/scripts/python.sh']) assert.equal(windowsSmoke([file], ci), true, file);
  for (const file of ['desktop/renderer/app.js', 'tools/pr-verdict.py', 'src/ai/score.py', 'tools/ship.sh', 'tools/sub/x.sh.md']) assert.equal(windowsSmoke([file], ci), false, file);
});

test('the check is the app launch, the relay and one settings step: short, on SQLite', () => {
  assert.equal(WINDOWS_SMOKE.suite, 'settings');
  assert.deepEqual(WINDOWS_SMOKE.steps, ['every Settings section renders']);
});

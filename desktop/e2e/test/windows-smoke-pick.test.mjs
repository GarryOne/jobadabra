// A pull request that changes CI plumbing or shell runs one short Windows check (PR 3 of the PR-checks plan; owner's yes, 26 Oct 2026): beta 40261885119 found
// Git Bash's tar reading "D:\a\_temp\..." as a host only after #1997 merged (all 19 Windows suites red at the relay step); no PR check ran on Windows.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {windowsCiText, windowsSmoke, WINDOWS_SMOKE} from '../lib/pr-suites.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = file => { try { return fs.readFileSync(path.join(repo, file), 'utf8'); } catch { return null; } };

test('what the Windows run runs starts the check: its workflow, the actions and workflows it uses, the scripts its steps name', () => {
  const files = {
    '.github/workflows/e2e-windows.yml': '# tools/ship.sh is never run here\nsteps:\n  - uses: ./.ci-relay/.github/actions/free-ai-relay\n  - run: bash lock-tools/tools/e2e-lock.sh acquire   # not tools/old.sh\n  - run: scripts/python.sh\n  approve:\n    uses: ./.github/workflows/beta-approve.yml',
    '.github/actions/free-ai-relay/action.yml': 'runs:\n  steps:\n    - run: bash tools/relay-tar.sh',
    '.github/workflows/beta-approve.yml': 'on: workflow_call',
  };
  const ci = windowsCiText(file => files[file] ?? null);
  for (const file of ['.github/workflows/e2e-windows.yml', '.github/actions/free-ai-relay/action.yml', '.github/actions/free-ai-relay/relay.sh', '.github/workflows/beta-approve.yml',
    'tools/e2e-lock.sh', 'tools/relay-tar.sh', 'desktop/scripts/python.sh']) assert.equal(windowsSmoke([file], ci), true, file);
  for (const file of ['tools/ship.sh', 'tools/old.sh', '.github/workflows/e2e.yml', 'desktop/renderer/app.js', 'src/ai/score.py']) assert.equal(windowsSmoke([file], ci), false, file);
});

// e2e audit, owner's yes 26 Oct 2026: any .github/ file, or a script named in any workflow's comment, started a Windows run on 5 of 32 PRs that Windows never runs.
test('the real tree: the audited PRs start the Windows check only when they change what Windows runs', () => {
  const ci = windowsCiText(read);
  assert.ok(ci.files.includes('.github/actions/free-ai-relay/action.yml'), 'positive control: #1997 broke Windows through the relay action');
  for (const file of ['.github/workflows/central-scout.yml', 'tools/ship.sh', '.github/workflows/main-steps.yml', 'tools/pr-verdict.py']) assert.equal(windowsSmoke([file], ci), false, `${file} (#2073/#2088, #2090, #2070)`);
  for (const file of ['.github/workflows/e2e-windows.yml', 'tools/e2e-lock.sh', '.github/actions/free-ai-relay/action.yml']) assert.equal(windowsSmoke([file], ci), true, file);
});

test('the check is the app launch, the relay and one settings step: short, on SQLite', () => {
  assert.equal(WINDOWS_SMOKE.suite, 'settings');
  assert.deepEqual(WINDOWS_SMOKE.steps, ['every Settings section renders']);
});

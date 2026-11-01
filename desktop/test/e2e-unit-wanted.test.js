// Which pushes run the e2e harness's own unit tests (cd desktop/e2e && npm test, what CI's e2e.yml "plan" job runs) in the push hook (tools/e2e-unit-wanted.mjs). Fake ranges.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {wantsE2eUnit} from '../../tools/e2e-unit-wanted.mjs';

test('a push touching the harness, the extension, the ladder or the page-kind code runs the e2e unit tests', () => {
  for (const file of ['desktop/e2e/lib/model.mjs', 'desktop/e2e/test/harness/artifacts.test.mjs', 'extension/page-files.js', 'extension/page/fill.js', 'desktop/lib/ladder/rung2-sketch.js', 'desktop/lib/page-kind.js', 'desktop/lib/account-judge.js', 'desktop/lib/form-judge.js']) {
    assert.equal(wantsE2eUnit([file, 'README.md']), true, file);
  }
});

test('a push that touches none of them does not pay the extra minute: docs, the renderer, the worker, the site, python', () => {
  assert.equal(wantsE2eUnit(['docs/flows/ladder.md', 'desktop/renderer/pages/jobs.js', 'desktop/lib/notion.js', 'app-core/src/x.js', 'site/src/y.js', 'src/daily.py', 'tests/test_x.py']), false);
  assert.equal(wantsE2eUnit([]), false);
});

test('the hook runs it (a block in tools/pre-push-check.sh) and the CI command is the one it runs', () => {
  const hook = fs.readFileSync(new URL('../../tools/pre-push-check.sh', import.meta.url), 'utf8');
  assert.match(hook, /node "\$repo\/tools\/e2e-unit-wanted\.mjs"/);
  assert.match(hook, /\(cd desktop\/e2e && npm test\)/);
  // Why (owner, 30 Oct 2026, option C): CI runs the harness's own tests in harness.yml, every file, with the hook's command; as 3 parts, each part's share comes from env TEST_SHARD (1 Nov 2026).
  assert.match(fs.readFileSync(new URL('../../.github/workflows/harness.yml', import.meta.url), 'utf8'), /working-directory: desktop\/e2e\n(\s+#.*\n)*(\s+env:\n(\s+\S.*\n)+)?\s+run: npm test\n/);
});

test('the suite no longer rewrites a tracked file: the playwright blob report is ignored', () => {
  assert.match(fs.readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8'), /^desktop\/e2e\/blob-report\/?$/m);
});

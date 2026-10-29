// A replay workflow starts on a PR only for what it loads (owner, 14 Oct 2026: #771 changed the recorder and ran every page case through `desktop/e2e/**`):
// its `on: pull_request: paths:` lists exactly tools/replay-files.mjs's files for it (the job's pages, the extension, the app, every script its steps start), plus install files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WORKFLOW_JOB, workflowFiles, pathEntries, listedPaths as prPaths, INSTALL} from '../../tools/replay-files.mjs';
for (const workflow of Object.keys(WORKFLOW_JOB)) test(`${workflow}: a PR starts it for exactly the files it loads`, () => {
  const listed = prPaths(workflow), wanted = pathEntries(workflowFiles(workflow));
  assert.deepEqual(wanted.filter(entry => !listed.includes(entry)), [], `${workflow} misses files it loads: run node tools/replay-files.mjs --paths ${workflow}`);
  assert.deepEqual(listed.filter(entry => !wanted.includes(entry) && !INSTALL.test(entry)), [], `${workflow} lists files it does not load`);
  assert.ok(!listed.some(entry => /^desktop\/e2e\/(\*\*|lib\/\*\*|test\/\*\*)$/.test(entry)), `${workflow}: no glob over the whole harness`);
});

test('a script a step starts is part of its workflow\'s files (the replays report imports the upload code)', () => {
  assert.ok(workflowFiles('page-cases.yml').has('desktop/e2e/lib/applying-report.mjs'));
  assert.ok(!workflowFiles('page-cases.yml').has('desktop/e2e/record-sites.mjs'), 'the recorder is not a page case');
});

test('each replay workflow checks its own paths first, so a new import cannot slip past a PR that does not run this suite (a worker-only PR)', () => {
  for (const workflow of Object.keys(WORKFLOW_JOB)) {
    const out = execFileSync(process.execPath, [fileURLToPath(new URL('../../tools/replay-files.mjs', import.meta.url)), '--check', workflow], {encoding: 'utf8'});
    assert.match(out, /list everything it loads/, workflow);
  }
});

test('a health workflow without a pull_request trigger has no PR paths to generate', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../../tools/replay-files.mjs', import.meta.url)), '--paths', 'e2e-flip.yml'], {encoding: 'utf8'});
  assert.match(out, /no pull_request paths/);
  assert.doesNotMatch(out, /^\s*- /m, 'workflow_run cannot filter by changed paths or install files');
});

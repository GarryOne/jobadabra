// Layer 2 (a throwaway Electron, no demo window): the CV check reads real PDFs, printed by the app's own Chromium and read by its own PDF reader: a plain CV passes, each known problem is
// found, a picture of a CV fails. PR-time counterpart of the e2e `settings` step "the CV check reads real PDFs…" (night/beta journey J14, which STAYS in e2e: it also runs the
// cvCheckRun handler on the person's profile folder). Added 1 Nov 2026 (R2). The hang guard is the spawn timeout; the script quits as soon as it has written its answer.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {FIXTURES} from '../../e2e/lib/cvfixtures.mjs';
import {needsElectron} from '../../test/needs-electron.js';

const desktop = fileURLToPath(new URL('../..', import.meta.url));

test('the CV check reads real PDFs: a plain CV passes, each known problem is found, a picture of a CV fails', needsElectron, () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cv-probe-'));
  try {
    const out = path.join(folder, 'answer.json');
    const run = spawnSync(path.join(desktop, 'node_modules', '.bin', 'electron'), [fileURLToPath(new URL('./cv-check-main.js', import.meta.url))], {
      cwd: desktop, encoding: 'utf8', timeout: 120000, env: {...process.env, JOB_PILOTTO_CV_PROBE_DIR: folder, JOB_PILOTTO_CV_PROBE_OUT: out}});
    assert.ok(fs.existsSync(out), `the probe wrote no answer (exit ${run.status}, signal ${run.signal}): ${(run.stderr || run.stdout || '').slice(-600)}`);
    const answer = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(answer.error, undefined, answer.error);
    for (const [name, fixture] of Object.entries(FIXTURES)) {
      const checks = answer[name]?.checks || {};
      const wrong = [...fixture.pass.filter(id => checks[id] !== 'pass').map(id => `${id} should pass but is ${checks[id]}`), ...fixture.fail.filter(id => checks[id] === 'pass').map(id => `${id} should be flagged`)];
      assert.deepEqual(wrong, [], `${name} (score ${answer[name]?.score})`);
    }
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

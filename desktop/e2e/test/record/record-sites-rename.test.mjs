// The recording workflow was "Pool smoke" (pool-smoke.yml) until 15 Oct 2026 (owner: its one job is recording). The old name may stay ONLY where an earlier run's data is still read
// (14 days of artifacts: the site ledger and each row's last CI run, the waiting queue; the replay's records are the published release only since 15 Oct 2026). A new mention anywhere else fails here, and each reader must read BOTH names,
// or the rename would silently drop today's ledger (a host visited twice would be visited again).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {recordVar} from '../../../../tools/record-env.mjs';

const ROOT = path.resolve(new URL('../../../..', import.meta.url).pathname);
const READERS = ['.github/workflows/record-sites.yml', 'desktop/e2e/captures.mjs', 'desktop/e2e/pool-ci-wait.mjs'];
const ALLOWED = [...READERS, 'tests/test_red_main.py', 'desktop/e2e/test/record-sites-rename.test.mjs'];
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('the workflow file is record-sites.yml; the old name is only in the readers of earlier runs', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.github/workflows/record-sites.yml')));
  assert.ok(!fs.existsSync(path.join(ROOT, '.github/workflows/pool-smoke.yml')));
  assert.match(read('.github/workflows/record-sites.yml'), /^name: CI · Record sites \(by hand\)/m);
  const files = execFileSync('git', ['grep', '-l', '-i', '-E', 'pool-smoke|pool smoke', '--', '.', ':!docs/superpowers'], {cwd: ROOT, encoding: 'utf8'}).split('\n').filter(Boolean);
  assert.deepEqual(files.filter(file => !ALLOWED.includes(file)), [], 'the old name outside the readers of earlier runs');
});

test('every reader of earlier runs reads the new name AND the old one', () => {
  for (const file of READERS) {
    const text = read(file);
    assert.match(text, /record-sites|Record sites/, `${file}: the new name`);
    assert.match(text, /pool-smoke|Pool smoke/, `${file}: the old name (runs of the last 14 days)`);
  }
  assert.match(read('.github/workflows/record-sites.yml'), /pool-smoke-state-\$id/, 'the old state artifact name');
});

// The command followed on 15 Oct 2026 (owner: "`npm run smoke` shouldn't be `npm run record-sites`?"): `smoke` only prints the new name and fails; no doc, skill, page or message says the old one.
test('the recording command is npm run record-sites; npm run smoke only says so', () => {
  const scripts = JSON.parse(read('desktop/e2e/package.json')).scripts;
  assert.equal(scripts['record-sites'], 'node record-sites.mjs');
  assert.match(scripts.smoke, /renamed: npm run record-sites/);
  assert.doesNotMatch(scripts.smoke, /smoke\.mjs/, 'the old command no longer runs a visit');
  let found = '';
  // pool-ci-triggers.test.mjs names the old command on purpose: no workflow may run a visit under either name.
  try { found = execFileSync('git', ['grep', '-l', 'npm run smoke', '--', '.', ':!docs/superpowers/specs', ':!desktop/e2e/test/record-sites-rename.test.mjs', ':!desktop/e2e/test/pool-ci-triggers.test.mjs'], {cwd: ROOT, encoding: 'utf8'}); } catch (error) { if (error.status !== 1) throw error; }   // 1 = no match
  const files = found.split('\n').filter(Boolean);
  assert.deepEqual(files, [], 'the old command in docs or code');
});

// The runner file and its settings followed (15 Oct 2026): desktop/e2e/smoke.mjs is record-sites.mjs, SMOKE_* is RECORD_* (the old names still read, with one warning), the log lines start "record-sites:".
// What keeps its old name on purpose: the desktop app's own screenshot hooks (JOB_PILOTTO_SMOKE_*), mac-smoke / windows-smoke (the installer smoke tests), the on-disk data (smoke-reports, smoke-sites.json)
// and the site's `smoke` upload source: renaming those would orphan data or mean something else.
const SETTINGS = ['PAIRED', 'KEEP_CANDIDATES', 'REPORTS', 'CANDIDATES', 'CAPTURES', 'SITES', 'MAX_ROWS', 'MAX_USD', 'ELIGIBILITY', 'SHARE', 'SECONDS', 'ELECTRON_LEG', 'NO_ELECTRON', 'ELECTRON'];
const gitGrep = (pattern, ...excluded) => {
  try { return execFileSync('git', ['grep', '-n', '-P', pattern, '--', '.', ':!docs/superpowers', ':!db/migrations', ...excluded.map(file => `:!${file}`)], {cwd: ROOT, encoding: 'utf8'}).split('\n').filter(Boolean); } catch (error) { if (error.status !== 1) throw error; return []; }   // 1 = no match
};

test('no file, script or doc names smoke.mjs or the SMOKE_ settings any more', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'desktop/e2e/record-sites.mjs')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'desktop/e2e/smoke.mjs')) && !fs.existsSync(path.join(ROOT, 'desktop/e2e/lib/smoke.mjs')));
  assert.deepEqual(gitGrep('(?<![-\\w])smoke\\.(test\\.)?mjs', 'desktop/e2e/test/record-sites-rename.test.mjs'), [], 'smoke.mjs in code or docs');
  // The fallback (tools/record-env.mjs) is the only place that may spell an old SMOKE_ name, and the tests that prove it; JOB_PILOTTO_SMOKE_* is the app's own hook.
  const old = gitGrep(`(?<![A-Z_])SMOKE_(${SETTINGS.join('|')})(?![A-Z_])`, 'tools/record-env.mjs', 'desktop/e2e/test/record-sites-rename.test.mjs', 'desktop/e2e/test/record-sites.test.mjs');
  assert.deepEqual(old, [], 'an old SMOKE_ setting named outside the fallback (new code uses RECORD_ + recordVar)');
});

test('the runner\'s log lines start "record-sites:"', () => {
  const runner = [read('desktop/e2e/record-sites.mjs'), read('desktop/e2e/lib/record-sites-paths.mjs')].join('\n');
  assert.doesNotMatch(runner, /log\(`smoke: |line: `smoke: /);
  assert.match(runner, /console\.log\(`record-sites: /);
});

test('each old SMOKE_ setting is still read: the new name first, the old one as a fallback with one warning', () => {
  for (const name of SETTINGS) {
    const lines = [];
    assert.equal(recordVar(name, {[`SMOKE_${name}`]: 'old'}, {warn: line => lines.push(line)}), 'old', `${name}: the old name works`);
    assert.equal(recordVar(name, {[`SMOKE_${name}`]: 'old'}, {warn: line => lines.push(line)}), 'old');
    assert.equal(lines.length, 1, `${name}: one warning, not one per read`);
    assert.match(lines[0], new RegExp(`SMOKE_${name} is the old name: use RECORD_${name}`));
    assert.equal(recordVar(name, {[`RECORD_${name}`]: 'new', [`SMOKE_${name}`]: 'old'}, {warn: () => assert.fail('no warning when the new name is set')}), 'new', `${name}: the new name wins`);
  }
  assert.equal(recordVar('SHARE', {SMOKE_PER_NIGHT: '6'}, {old: 'PER_NIGHT', warn: () => {}}), '6', 'SHARE\'s older name');
  assert.equal(recordVar('PAIRED', {}), undefined);
});

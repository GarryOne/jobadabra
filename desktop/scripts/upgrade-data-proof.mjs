// Upgrade + data test for ONE old release (CI, report only): the old release fills a data folder through its own bundled Python, the build of main replaces it, the app opens
// that folder, and every job, answer and setting must still be there (lib/data-fingerprint.js).
//   node scripts/upgrade-data-proof.mjs <label e.g. 0.8.60> <old archive (.zip / .exe)> <new archive> <output folder>
// Exit: 0 everything kept · 1 data lost or changed · 2 the run itself failed or the compare is blind · 3 the old release could not seed (not a data finding).
// Why (owner, 1 Nov 2026, five report-only methods): nothing played a real filled store through an update. Spec docs/superpowers/specs/2026-11-01-upgrade-data-test-design.md.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compare, describe, fingerprintFolder, withoutOne} from '../lib/data-fingerprint.js';
import {platform, seedFiles} from './upgrade-data-lib.mjs';
import {jobsScreen} from './smoke-screens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [label, oldArchive, newArchive, out] = process.argv.slice(2);
if (!label || !oldArchive || !newArchive || !out) throw new Error('usage: node scripts/upgrade-data-proof.mjs <label> <old archive> <new archive> <output folder>');
if (!process.env.CI) throw new Error('the upgrade test installs apps and runs only on CI (CI=true)');
fs.mkdirSync(out, {recursive: true});
const t0 = Date.now();
const say = line => console.log(`• [${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s] ${line}`);
const system = platform();
const summary = {from: label, os: process.platform, state: 'error', ok: false, lost: [], changed: [], added: 0, allowed: 0, stale: [], entries: {before: 0, after: 0}, note: ''};
const finish = (state, code, note = '') => {
  Object.assign(summary, {state, ok: state === 'kept', note, seconds: Math.round((Date.now() - t0) / 1000), run: process.env.GITHUB_RUN_ID || ''});
  fs.writeFileSync(path.join(out, `upgrade-${label}-${process.platform}.json`), JSON.stringify(summary, null, 2));
  say(`${state}${note ? `: ${note}` : ''}`);
  return code;
};

const expected = JSON.parse(fs.readFileSync(path.join(here, 'upgrade-expected.json'), 'utf8'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-upgrade-data-'));   // never the person's folder: the app is told to use this one by JOBADABRA_USER_DATA
let code = 2;
try {
  const old = await system.install(oldArchive);
  say(`release ${label} installed: ${old.exe}`);
  fs.mkdirSync(path.join(userData, 'data'), {recursive: true});
  fs.mkdirSync(path.join(userData, 'config'), {recursive: true});
  const seeded = spawnSync(old.python, [path.join(here, 'upgrade-seed.py')], {cwd: old.pilot, encoding: 'utf8', timeout: 120000,
    env: {...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', JOBADABRA_NO_DOTENV: '1', JOBADABRA_STORE: 'sqlite',
      JOBADABRA_DATA_DIR: path.join(userData, 'data'), JOBADABRA_CONFIG_DIR: path.join(userData, 'config')}});
  if (seeded.status === 3) { code = finish('seed-failed', 3, `release ${label} could not fill its own store: ${(seeded.stderr || '').trim().split('\n').pop()}`); throw code; }
  if (seeded.status !== 0) throw new Error(`the seed script exited ${seeded.status}: ${(seeded.stderr || seeded.error || '').toString().trim().split('\n').slice(-3).join(' | ')}`);
  seedFiles(userData);
  const before = fingerprintFolder(userData);
  summary.entries.before = Object.keys(before).length;
  if (summary.entries.before < 100) throw new Error(`the seed wrote only ${summary.entries.before} entries: nothing to compare`);
  say(`seeded by release ${label}: ${seeded.stdout.trim()}, ${summary.entries.before} entries fingerprinted`);

  const current = await system.update(newArchive);
  say(`updated to the build of main: ${current.exe}`);
  await jobsScreen({exe: current.exe, out, prefix: `upgrade-${label}`, say, userData});   // opens the app on that folder: every migration the start runs has run
  const after = fingerprintFolder(userData);
  const result = compare(before, after, expected);
  Object.assign(summary, {lost: result.lost, changed: result.changed.map(item => item.key), added: result.added.length, allowed: result.allowed.length,
    stale: result.stale.map(entry => entry.key), entries: result.counts});
  for (const line of describe(result)) say(line);
  // Positive control: the compare must call a loss a loss, or its green means nothing.
  const control = withoutOne(before);
  if (compare(before, control.fingerprint, expected).lost.join() !== control.key) { code = finish('blind', 2, 'the compare does not see a loss it was given'); throw code; }
  code = result.ok ? finish('kept', 0) : finish('lost', 1, `${result.lost.length} lost, ${result.changed.length} changed`);
} catch (error) {
  if (typeof error !== 'number') code = finish('error', 2, String(error.message || error).split('\n').slice(0, 6).join(' | '));
} finally {
  try { system.remove(); } catch { /* the next release checks again */ }
  fs.rmSync(userData, {recursive: true, force: true});
}
process.exit(code);

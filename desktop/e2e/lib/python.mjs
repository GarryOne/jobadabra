// The engine's Python for every suite or helper that runs it directly (pool, mailreading, visitread, personas, employers, forget, storemove, quality), with
// an environment that cannot reach anyone's real data. Guarded by test/python-env.test.mjs.
// PYTHONUTF8: files and pipes in UTF-8 on Windows too, whose default is the ANSI code page (7 Oct 2026: the pool suite stopped on Windows at
// "'charmap' codec can't decode byte 0x8f" reading config/search.json, whose ⚙️ heading the app's engine reads fine).
// Isolation (owner's rule: a test never touches the live app, real accounts or real data; 9 Oct 2026: personas and employers ran the engine with the whole
// shell environment): only the shell basics below are inherited, never a token or key; the engine does not follow an app set up on this computer
// (JOB_PILOTTO_FOLLOW_APP=0, src/paths.py follow_app) nor read a .env; HOME is a temp folder. A key a step needs (an eval's AI key) is passed by the caller
// in `extra`, by name. `realHome` keeps this computer's HOME for a step that runs the Claude Code or Codex CLI, which finds its sign-in there (the app
// under test is launched the same way, lib/app.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const SHELL = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SYSTEMROOT', 'USER', 'LOGNAME', 'SHELL'];
const SECRET = /TOKEN|SECRET|API_KEY|PASSWORD|REFRESH|CREDENTIAL/i;

export const python = () => process.env.E2E_PYTHON || (fs.existsSync(path.join(repo, '.venv', 'bin', 'python')) ? path.join(repo, '.venv', 'bin', 'python') : 'python3');

const inTemp = folder => [os.tmpdir(), fs.realpathSync(os.tmpdir())].some(root => path.resolve(folder).startsWith(root));

// Fails unless `env` is isolated: no app-following, no .env, HOME in a temp folder (unless realHome), and no secret but the ones the caller named.
export function assertIsolated(env, {allowed = [], realHome = false} = {}) {
  const problems = [];
  if (env.JOB_PILOTTO_FOLLOW_APP !== '0') problems.push('JOB_PILOTTO_FOLLOW_APP is not 0');
  if (env.JOB_PILOTTO_NO_DOTENV !== '1') problems.push('JOB_PILOTTO_NO_DOTENV is not 1');
  if (!realHome && !inTemp(env.HOME || '')) problems.push(`HOME is not a temp folder: ${env.HOME}`);
  // With this computer's HOME (a CLI's sign-in only), the engine's own data and config must still be temp: HOME serves the login, never the person's data.
  for (const name of ['JOB_PILOTTO_DATA_DIR', 'JOB_PILOTTO_CONFIG_DIR']) if (realHome && !inTemp(env[name] || '')) problems.push(`${name} is not a temp folder: ${env[name] || '(unset)'}`);
  const secrets = Object.keys(env).filter(name => SECRET.test(name) && !allowed.includes(name));
  if (secrets.length) problems.push(`it carries ${secrets.join(', ')}`);
  if (problems.length) throw new Error(`the engine's environment is not isolated: ${problems.join('; ')}`);
  return env;
}

// -> the environment for one engine run. `home`: a temp folder to use as HOME (a test profile), else a fresh one.
export function pythonEnv(extra = {}, {home = '', realHome = false} = {}) {
  const env = Object.fromEntries(SHELL.filter(name => process.env[name]).map(name => [name, process.env[name]]));
  env.HOME = realHome ? os.homedir() : home || fs.mkdtempSync(path.join(os.tmpdir(), 'jp-engine-home-'));
  // With the real HOME the engine's data and config folders are temp ones unless the caller gives its own (asserted below).
  const scratch = realHome ? fs.mkdtempSync(path.join(os.tmpdir(), 'jp-engine-data-')) : '';
  Object.assign(env, {PYTHONUTF8: '1', JOB_PILOTTO_FOLLOW_APP: '0', JOB_PILOTTO_NO_DOTENV: '1'},
    realHome ? {JOB_PILOTTO_DATA_DIR: path.join(scratch, 'data'), JOB_PILOTTO_CONFIG_DIR: path.join(scratch, 'config')} : {},
    // A coverage run (lib/coverage.mjs pythonCoverage): the Python step map's recorder, which names src/ lines from the repo; never the shell's own PYTHONPATH.
    process.env.E2E_PY_COVERAGE_DIR ? {E2E_PY_COVERAGE_DIR: process.env.E2E_PY_COVERAGE_DIR, E2E_PY_COVERAGE_ROOT: repo, PYTHONPATH: process.env.PYTHONPATH} : {}, extra);
  return assertIsolated(env, {allowed: Object.keys(extra), realHome});
}

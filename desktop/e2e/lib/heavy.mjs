// Takes the machine-wide heavy-run lock (tools/heavy-lock.sh) for an e2e entry point started by hand, by re-running itself under the lock; guarded by test/replay/heavy.test.mjs.
// Call heavy('name', import.meta.url) right after the imports of a script that opens browsers or apps. It does nothing when the file is only imported (a unit test),
// when the lock is already held by a parent run (JP_HEAVY_HELD), when JOB_PILOTTO_HEAVY=0, for --list / --help, or when bash or the script is not there.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const LOCK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tools', 'heavy-lock.sh');

// klass: the entry point's default priority class for this run (an explicit JOB_PILOTTO_HEAVY_CLASS in the environment always wins) (proof | pool | explore | other; tools/heavy-lock-classes.sh); without it the lock reads it from `what`.
export function heavy(what, metaUrl, {argv = process.argv, env = process.env, run = spawnSync, exit = process.exit, klass} = {}) {
  if (env.JP_HEAVY_HELD || env.JOB_PILOTTO_HEAVY === '0') return false;
  if (!argv[1] || path.resolve(argv[1]) !== fileURLToPath(metaUrl)) return false;
  if (argv.some(arg => arg === '--list' || arg === '--help') || !fs.existsSync(LOCK)) return false;
  const result = run('bash', [LOCK, what, process.execPath, ...process.execArgv, ...argv.slice(1)], {stdio: 'inherit', ...(klass && !env.JOB_PILOTTO_HEAVY_CLASS ? {env: {...env, JOB_PILOTTO_HEAVY_CLASS: klass}} : {})});
  if (result.error) return false;   // no bash: run without the lock
  exit(result.status ?? 1);
  return true;
}

// Between two parts of a run that holds the lock (the pool, between sites): gives the place to a waiting proof or shorter run and waits for it back (`heavy-lock.sh yield`). A no-op outside a hold,
// with JOB_PILOTTO_HEAVY=0, or without bash; never throws.
export function yieldHeavy({env = process.env, run = spawnSync} = {}) {
  if (!env.JP_HEAVY_HELD || env.JOB_PILOTTO_HEAVY === '0' || !fs.existsSync(LOCK)) return false;
  try { return run('bash', [LOCK, 'yield'], {stdio: 'inherit', env}).status === 0; } catch { return false; }
}

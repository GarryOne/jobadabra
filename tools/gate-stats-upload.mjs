// Sends the push gate's daily counts to /admin/operations/agent-coding, at most once a day (owner, 1 Nov 2026: "Once a day from ship.sh"): tools/ship.sh runs it as its last step.
// Best effort: a missing log, key or network, a refusal or a slow answer ends quietly with exit 0 and never stops a ship; the stamp is written only after the site answered ok, so a failed day tries again.
// The key is read from the macOS Keychain (job-pilotto.site.selfheal_publish_key) when it runs, never from a file or the environment. GATE_STATS_UPLOAD=0 turns it off; --force skips the stamp.
// Only counts, seconds and fixed check labels leave this Mac (tools/gate-stats.mjs). Test: desktop/test/gate-stats.test.js.
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {byDay, parseLog} from './gate-stats.mjs';

export const URL_DEFAULT = 'https://www.jobpilotto.top/agent-coding/data';
// Why (1 Nov 2026): 5 s so a slow site never holds a landing; the stamp keeps it to one call a day.
const TIMEOUT_MS = 5000;

// One upload: returns 'off' | 'no-log' | 'done-today' | 'no-key' | 'no-days' | 'sent' | 'refused: <status>' | 'failed'. Seams: read, key, send, stamp (files), so a test touches no network, Keychain or disk.
export async function upload({log, stampFile, now = new Date(), force = false, read = path => readFileSync(path, 'utf8'), has = existsSync, key, send, writeStamp = (file, text) => writeFileSync(file, text)}) {
  if (process.env.GATE_STATS_UPLOAD === '0') return 'off';
  if (!log || !has(log)) return 'no-log';
  const today = now.toISOString().slice(0, 10);
  if (!force && stampFile && has(stampFile) && read(stampFile).trim() === today) return 'done-today';
  const secret = await key();
  if (!secret) return 'no-key';
  const days = byDay(parseLog(read(log)), {now});
  if (!days.length) return 'no-days';
  const status = await send(JSON.stringify({kind: 'gate', days}), secret);
  if (status !== 200) return typeof status === 'number' ? `refused: ${status}` : 'failed';
  if (stampFile) writeStamp(stampFile, `${today}\n`);
  return 'sent';
}

const keychain = () => { try { return execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.selfheal_publish_key', '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; } };
const post = (body, secret) => fetch(process.env.GATE_STATS_URL || URL_DEFAULT, {method: 'PUT', headers: {Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json'}, body, signal: AbortSignal.timeout(TIMEOUT_MS)})
  .then(response => response.status, () => null);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const common = execFileSync('git', ['-C', fileURLToPath(new URL('..', import.meta.url)), 'rev-parse', '--path-format=absolute', '--git-common-dir'], {encoding: 'utf8'}).trim();
    const result = await upload({log: `${common}/gate-timing.log`, stampFile: `${common}/gate-stats-upload.stamp`, force: process.argv.includes('--force'), key: async () => keychain(), send: post});
    console.log(`gate-stats: ${result}`);
  } catch (error) { console.log(`gate-stats: failed (${error.code || 'error'})`); }
}

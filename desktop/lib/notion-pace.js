// One Notion pace for every process on this computer that uses the same Notion connection: the app, the Python
// engine it starts (jobs check, sync, descriptions) and a terminal run. Notion allows about 3 requests a second per
// connection, counted together, so each process pacing only itself still bursts past it. They take turns through
// a small file in the temp folder, named after a hash of the token (src/notion/pace.py is the Python side; same
// file, same format "<next slot ms> <calm until ms>"). A mkdir lock makes each claim atomic. If the file can't be
// used, the process falls back to its own pace.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GAP_MS = Number(process.env.JOB_PILOTTO_NOTION_GAP_MS) || 340;  // ~3 a second (Notion's limit)
const LOCK_STALE_MS = 3000;
const LOCK_TRIES = 200;

/** Recognize the fixture service's HTTP loopback address, with or without a port (also src/notion/pace.py). */
export const isLoopback = value => /^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(String(value || ''));

/** True only for an explicitly marked in-memory service in e2e; local fault proxies retain production pacing. */
// Why (31 Oct 2026, owner review of bab7120): the shared pacer owns the exemption so every client and subprocess follows one rule.
export const isStandIn = (env = process.env) => !!env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_E2E_NOTION_STANDIN === '1' && isLoopback(env.JOB_PILOTTO_E2E_NOTION_BASE_URL);

export const paceFile = token => path.join(os.tmpdir(),
  `jobadabra-notion-${crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12)}.pace`);

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function locked(file, fn) {
  const lock = `${file}.lock`;
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, {recursive: true, force: true}); } catch {}
      if (i >= LOCK_TRIES) throw new Error('Notion pace lock busy');
      await pause(5);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, {recursive: true, force: true}); }
}
const read = file => {
  const [next = 0, calm = 0] = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').trim().split(/\s+/).map(Number);
  return {next: next || 0, calm: calm || 0};
};

// The moment (ms) this request may go, shared across processes; null when the file can't be used.
export async function claim(token, now = Date.now) {
  if (isStandIn()) return now();
  const file = paceFile(token);
  try {
    return await locked(file, () => {
      const {next, calm} = read(file);
      const at = Math.max(next, calm, now());
      fs.writeFileSync(file, `${at + GAP_MS} ${calm}`);
      return at;
    });
  } catch { return null; }
}

// After a 429: every process waits until `until`.
export async function calmUntil(token, until) {
  if (isStandIn()) return;
  const file = paceFile(token);
  try {
    await locked(file, () => {
      const {next, calm} = read(file);
      fs.writeFileSync(file, `${next} ${Math.max(calm, until)}`);
    });
  } catch {}
}

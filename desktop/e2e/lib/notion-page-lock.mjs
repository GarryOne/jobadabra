// A machine-wide lock on the REAL Notion test page: only a run on store 'notion' (notion-real) uses it; runs on SQLite or the stand-in never do (lib/store.mjs).
// Same shape as tools/heavy-lock.sh: a directory holding pid, session, what, since; stale when its pid is gone; the waiting run prints who holds it.
// Taken once in lib/context.mjs openContext, so every caller gets it. Escape hatches, said in the log: JOB_PILOTTO_NOTION_LOCK=0 (no lock),
// JOB_PILOTTO_NOTION_LOCK_WAIT=<s> (longest wait, default 1800). Guarded by test/notion-page-lock.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LOCK = path.join(process.env.TMPDIR || os.tmpdir(), 'job-pilotto-notion-page', 'lock');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = (lock, name) => { try { return fs.readFileSync(path.join(lock, name), 'utf8').trim(); } catch { return ''; } };
const pidAlive = pid => { try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === 'EPERM'; } };

export const lockNeeded = ({store, env = process.env}) => store === 'notion' && env.JOB_PILOTTO_NOTION_LOCK !== '0' && !env.CI;

export function holderText(lock = LOCK) {
  const since = Number(read(lock, 'since')) || 0, clock = since ? new Date(since * 1000).toTimeString().slice(0, 8) : '?';
  return `pid ${read(lock, 'pid') || '?'} (${read(lock, 'what') || '?'}, session ${read(lock, 'session') || '?'}) since ${clock}, ${since ? Math.round(Date.now() / 1000 - since) : '?'}s ago`;
}

// -> {release()}. Waits while a live run holds the page (says who, every 30 s), takes over a stale lock, and after `wait` ms runs anyway.
export async function takeNotionPage({lock = LOCK, what, session = process.env.JOB_PILOTTO_SESSION || path.basename(process.cwd()), say = console.log, alive = pidAlive,
  every = 1000, wait = (Number(process.env.JOB_PILOTTO_NOTION_LOCK_WAIT) || 1800) * 1000} = {}) {
  fs.mkdirSync(path.dirname(lock), {recursive: true});
  const began = Date.now();
  let told = 0, ours = false;
  for (;;) {
    try { fs.mkdirSync(lock); ours = true; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const pid = read(lock, 'pid'), young = Date.now() - (fs.statSync(lock, {throwIfNoEntry: false})?.mtimeMs || 0) < 10000;
    if (pid ? !alive(pid) : !young) {   // its owner is gone (or never wrote its pid within 10 s)
      const gone = `${lock}.stale.${process.pid}`;
      try { fs.renameSync(lock, gone); say(`notion-page-lock: taking over a stale lock: ${read(gone, 'what')} (${read(gone, 'session')}; pid ${read(gone, 'pid')} is gone)`); fs.rmSync(gone, {recursive: true, force: true}); } catch { /* another run took it first */ }
      continue;
    }
    const waited = Date.now() - began;
    if (waited >= wait) { say(`notion-page-lock: waited ${waited / 1000} s for the page held by ${holderText(lock)}: running anyway`); break; }
    if (!told || waited - told >= 30000) { say(`notion-page-lock: ${what} waits: the Notion test page is held by ${holderText(lock)}; waited ${Math.round(waited / 1000)} s (JOB_PILOTTO_NOTION_LOCK=0 skips this)`); told = waited || 1; }
    await sleep(every);
  }
  if (ours) {
    fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); fs.writeFileSync(path.join(lock, 'session'), session);
    fs.writeFileSync(path.join(lock, 'what'), what); fs.writeFileSync(path.join(lock, 'since'), String(Math.floor(Date.now() / 1000)));
    if (told) say(`notion-page-lock: got the page after ${Math.round((Date.now() - began) / 1000)} s`);
  }
  return {release: () => { if (ours && read(lock, 'pid') === String(process.pid)) fs.rmSync(lock, {recursive: true, force: true}); }};
}

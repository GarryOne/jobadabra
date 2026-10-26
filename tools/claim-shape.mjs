#!/usr/bin/env node
// A claim per pool row, so parallel /fix-recorded-sites sessions never take the same shape (owner, 11 Oct 2026). One file per row in the Mac's QA folder
// (~/Library/Application Support/Job Pilotto QA/claims/<slug>.json: session, start time); created with O_EXCL, so of many sessions asking at once exactly one wins.
// A claim is stale (anyone may take it over) when it is older than TTL_MS or its session is not in the `--alive` list the skill passes from ListAgents.
// The same tool holds the other locks by fixed name: "e2e-page" (an old lock, no run needs it since 11 Oct 2026) and "flow-core" (--ttl 180); the holder renews by claiming again.
// Per-function claims (owner, 11 Oct 2026): `claim-part <file> [<function>]` takes one function of a flow-core file ("flow-core: <file>#<function>"); two sessions may hold different functions
// of one file. A whole-file claim (no function) blocks every function of it, and the whole core (`claim-part` with no file) blocks every part; a part also blocks those wider claims.
// Usage: node tools/claim-shape.mjs claim "<row name>" --session <me> [--alive a,b,c] [--ttl <minutes>]   exit 0 = yours, exit 1 = held (prints the holder)
//        node tools/claim-shape.mjs release "<row name>" --session <me>   |   node tools/claim-shape.mjs list [--alive a,b,c]
// Guard: desktop/test/claim-shape.test.js (it uses a temp folder, never the real one).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {poolRowNames, rowNameProblem} from './pool-rows.mjs';

export const TTL_MS = 6 * 60 * 60 * 1000;
export const CLAIMS = path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto QA', 'claims');
export const slug = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const fileOf = (dir, name) => path.join(dir, `${slug(name)}.json`);
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const stale = (held, now, alive) => !held || now - held.at > (held.ttl || TTL_MS) || (Array.isArray(alive) && !alive.includes(held.session));

// -> {ok: true} | {ok: false, holder, since}
export function claim(name, session, {dir = CLAIMS, now = Date.now(), alive, ttl = 0} = {}) {   // ttl (ms): a shorter life for a lock held only while something runs ("e2e-page", 30 min, renewed by the holder)
  if (!slug(name) || !session) return {ok: false, holder: '', error: 'a row name and a session are needed'};
  fs.mkdirSync(dir, {recursive: true});
  const file = fileOf(dir, name), body = JSON.stringify({name, session, at: now, ...(ttl ? {ttl} : {})});
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.writeFileSync(file, body, {flag: 'wx'}); return {ok: true}; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const held = read(file);
    if (held?.session === session) { fs.writeFileSync(file, body); return {ok: true}; }   // the holder renews
    if (!stale(held, now, alive)) return {ok: false, holder: held.session, since: held.at};
    try { fs.unlinkSync(file); } catch { /* another taker removed it first: try to create again */ }
  }
  return {ok: false, holder: read(file)?.session || '', since: read(file)?.at};
}

// ---- parts of the flow core (a file, a function of a file, or all of it) ----
export const CORE = 'flow-core';
export const partName = (file = '', fn = '') => (!file ? CORE : fn ? `${CORE}: ${file}#${fn}` : `${CORE}: ${file}`);
// Do two part names overlap? The whole core overlaps all; a file overlaps its functions; a function overlaps only itself.
const fileOfPart = name => (name === CORE ? '' : name.slice(CORE.length + 2).split('#')[0]);
export const overlaps = (a, b) => {
  if (a === b || a === CORE || b === CORE) return true;
  const [fileA, fileB] = [fileOfPart(a), fileOfPart(b)];
  return fileA === fileB && (!a.includes('#') || !b.includes('#'));
};
const rivals = (name, session, opts) => list({...opts, now: opts.now ?? Date.now()}).filter(held => held.session !== session && String(held.name).startsWith(CORE) && overlaps(held.name, name));

// -> {ok: true} | {ok: false, holder, since}. Claims the part, then looks again for an overlapping claim by someone else (two sessions asking for a file and one of its
// functions at once): a loser gives its claim back, so nobody is left holding a refused part.
export function claimPart(file, fn, session, {dir = CLAIMS, now = Date.now(), alive, ttl = 0} = {}) {
  const name = partName(file, fn), opts = {dir, now, alive};
  const before = rivals(name, session, opts);
  if (before.length) return {ok: false, holder: before[0].session, since: before[0].at};
  const got = claim(name, session, {...opts, ttl});
  if (!got.ok) return got;
  const after = rivals(name, session, opts);
  if (!after.length) return {ok: true};
  release(name, session, {dir});
  return {ok: false, holder: after[0].session, since: after[0].at};
}
export const releasePart = (file, fn, session, {dir = CLAIMS} = {}) => release(partName(file, fn), session, {dir});

export function release(name, session, {dir = CLAIMS} = {}) {
  const file = fileOf(dir, name), held = read(file);
  if (!held) return {ok: true};
  if (held.session !== session) return {ok: false, holder: held.session};
  fs.unlinkSync(file);
  return {ok: true};
}

export function list({dir = CLAIMS, now = Date.now(), alive} = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => file.endsWith('.json')).map(file => read(path.join(dir, file))).filter(held => held && !stale(held, now, alive));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, name] = process.argv.slice(2), flag = key => { const at = process.argv.indexOf(key); return at > 0 ? process.argv[at + 1] : ''; };
  const session = flag('--session'), alive = flag('--alive') ? flag('--alive').split(',').map(text => text.trim()).filter(Boolean) : undefined;
  if (command === 'list') { for (const held of list({alive})) console.log(`${held.session}\t${held.name}\t${new Date(held.at).toISOString()}`); process.exit(0); }
  if (command === 'claim-part' || command === 'release-part') {   // claim-part [<file> [<function>]] --session <me>
    const [file = '', fn = ''] = process.argv.slice(3).filter((text, at, all) => !text.startsWith('--') && !String(all[at - 1]).startsWith('--'));
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    if (file && !fs.existsSync(path.join(root, file))) { console.error(`no such file: ${file}`); process.exit(2); }
    if (fn && !fs.readFileSync(path.join(root, file), 'utf8').includes(fn)) { console.error(`${file} has no "${fn}": check the function name`); process.exit(2); }
    const done = command === 'claim-part' ? claimPart(file, fn, session, {alive, ttl: (Number(flag('--ttl')) || 180) * 60000}) : releasePart(file, fn, session);
    if (!done.ok) { console.error(`held by ${done.holder}${done.since ? ` since ${new Date(done.since).toISOString()}` : ''}`); process.exit(1); }
    console.log('ok'); process.exit(0);
  }
  const notRow = command === 'claim' && name !== 'e2e-page' && !String(name).startsWith(CORE) ? rowNameProblem(String(name || '').trim(), poolRowNames()) : '';   // a claim is joined to its row by name on /admin/form-filling/lab
  if (notRow) { console.error(`not claimed: ${notRow}`); process.exit(2); }
  const result = command === 'claim' ? claim(name, session, {alive, ttl: (Number(flag('--ttl')) || 0) * 60000}) : command === 'release' ? release(name, session) : {ok: false, error: 'usage: claim|release "<row name>" --session <me> | list'};
  if (!result.ok) { console.error(result.error || `held by ${result.holder}${result.since ? ` since ${new Date(result.since).toISOString()}` : ''}`); process.exit(1); }
  console.log('ok');
}

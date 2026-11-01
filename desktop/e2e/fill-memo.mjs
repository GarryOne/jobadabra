// Fills the model answers a recording lacks (a fix changed what the app asks): replays the row's network record on this Mac with the plan's claude -p for the missed asks only
// and merges the new answers into the record's model-memo.json (replay-net.mjs --fill-memo, lib/fill-memo.mjs); then replays it again WITHOUT asking to prove it is faithful.
//   node fill-memo.mjs <records dir> "<row>" [--out <dir>]      (npm run fill-memo -- <records dir> "<row>"; publish after: node records-publish.mjs <records dir>)
// Cost: the plan path, about $0.06 a row asked, once per changed ask; never an API key on a Mac. CI: only the refill workflow (.github/workflows/replay-refill.yml, JP_REFILL_CI=1, its own
// REPLAY_REFILL_ANTHROPIC_KEY, lib/refill.mjs). Old answers are never changed: a lost or changed old key fails the row. Guard: e2e/test/fill-memo.test.mjs, refill.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {newestPerRow} from './replay-records.mjs';
import {keyRefusal} from './lib/refill.mjs';
import {oldKeysKept} from './lib/fill-memo.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const [root, name] = process.argv.slice(2).filter(arg => !arg.startsWith('--')), at = process.argv.indexOf('--out');
if (!root || !name) { console.error('usage: node fill-memo.mjs <records dir> "<row>" [--out <dir>]'); process.exit(2); }
if (process.env.CI && process.env.JP_REFILL_CI !== '1') { console.error('fill-memo: the plan\'s claude -p, a Mac only; CI only through the refill workflow'); process.exit(2); }
if (process.env.CI && keyRefusal()) { console.error(keyRefusal()); process.exit(2); }
const row = newestPerRow(root).find(one => one.name === name);
if (!row) { console.error(`fill-memo: no record of "${name}" in ${root}`); process.exit(2); }
const out = at > 0 ? process.argv[at + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fill-memo-'));
let status = 0;
const replay = flags => { const work = path.join(out, flags.length ? 'fill' : 'check'); status = spawnSync(process.execPath, [path.join(here, 'replay-net.mjs'), row.dir, work, ...flags], {stdio: ['ignore', 'inherit', 'inherit']}).status || 0; try { return JSON.parse(fs.readFileSync(path.join(work, 'replay.json'), 'utf8')); } catch { return null; } };
const line = (label, result) => console.log(`fill-memo: ${name} ${label}: ${result ? `${result.liveHit}/${result.liveAsks} live asks answered, ${result.misses} extra, outcome ${result.outcome?.reached} ${result.outcome?.filled}/${result.outcome?.left}${result.filled != null ? `, ${result.filled} answer(s) filled` : ''}${result.tripped ? `, TRIPPED: ${result.tripped}` : ''}` : 'no result'}`);
console.log(`fill-memo: ${name}: filling (plan path, about $0.06 per ask answered; the network is replayed, no site visit)`);
const memoFile = path.join(row.dir, 'model-memo.json'), before = (() => { try { return JSON.parse(fs.readFileSync(memoFile, 'utf8')); } catch { return {}; } })();
const filled = replay(['--fill-memo']);
if (status === 3) process.exit(3);   // out of credits (replay-net.mjs said so)
line('filled', filled);
if (!filled || filled.tripped) process.exit(1);
const after = (() => { try { return JSON.parse(fs.readFileSync(memoFile, 'utf8')); } catch { return {}; } })(), lost = oldKeysKept(before, after);
if (lost.length) { console.error(`fill-memo: ${name}: ${lost.length} old answer key(s) lost or changed (${lost.slice(0, 3).join(', ')}): not kept`); process.exit(1); }
console.log(`fill-memo: ${name}: 0 old answer keys lost, ${Object.keys(after).filter(key => !key.includes('#')).length - Object.keys(before).filter(key => !key.includes('#')).length} new`);
line('check (no model)', replay([]));
console.log(`fill-memo: next: node ${path.join(here, 'records-publish.mjs')} ${root}`);

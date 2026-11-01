// The refill's per-row result, ready to leave a runner: the row's model-memo.json encrypted with the repo's PUBLIC key (net-record.pub.pem, as records-publish.mjs does: the memo carries
// the ask's page parts, so it never sits in an artifact in the clear) beside a meta.json with the row's name and spend (no page, no value). Only the publish job (NET_RECORD_KEY) opens it.
//   node refill-pack.mjs <records dir> "<row>" <fill out dir> <pack dir>      (pack dir: memo.enc, k.enc, meta.json)
// refill-merge.mjs reads the pack. Guard: e2e/test/refill.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {newestPerRow} from './replay-records.mjs';
import {nothingToRefill} from './lib/refill-resilience.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const [root, name, fillOut, pack, fillLog] = process.argv.slice(2);   // fillLog (optional): fill-memo's output; a fill that asked nothing is not a failure
if (!root || !name || !fillOut || !pack) { console.error('usage: node refill-pack.mjs <records dir> "<row>" <fill out dir> <pack dir>'); process.exit(2); }
const row = newestPerRow(root).find(one => one.name === name);
const memo = row && path.join(row.dir, 'model-memo.json');
if ((!memo || !fs.existsSync(memo)) && fillLog && nothingToRefill(fs.existsSync(fillLog) ? fs.readFileSync(fillLog, 'utf8') : '')) { console.log(`refill-pack: ${name}: nothing to refill (the fill asked no question)`); process.exit(0); }
if (!memo || !fs.existsSync(memo)) { console.error(`refill-pack: no memo for "${name}"`); process.exit(1); }
const spend = (() => { try { return JSON.parse(fs.readFileSync(path.join(fillOut, 'fill', 'refill-spend.json'), 'utf8')); } catch { return {}; } })();
fs.mkdirSync(pack, {recursive: true});
const key = path.join(pack, 'k');
execFileSync('openssl', ['rand', '-hex', '-out', key, '32']);
execFileSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-in', memo, '-out', path.join(pack, 'memo.enc'), '-pass', `file:${key}`]);
execFileSync('openssl', ['pkeyutl', '-encrypt', '-pubin', '-inkey', path.join(here, 'net-record.pub.pem'), '-pkeyopt', 'rsa_padding_mode:oaep', '-in', key, '-out', path.join(pack, 'k.enc')]);
fs.rmSync(key);
fs.writeFileSync(path.join(pack, 'meta.json'), JSON.stringify({name, usd: spend.usd ?? 0, calls: spend.calls ?? 0, filled: spend.filled ?? 0}));
console.log(`refill-pack: ${name}: ${spend.filled ?? 0} new answer(s), $${(spend.usd ?? 0).toFixed(4)}`);

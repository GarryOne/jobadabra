// What a fill replay keeps (lib/fill-memo.mjs): only new answers, with their notes, into the record's model-memo.json; the network record is never written.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {filledKeys, keepFilled} from '../../lib/fill-memo.mjs';

const folder = files => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fill-')); for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body)); return dir; };

test('only a key the record lacks is kept, with its notes; a kept answer is never replaced and the network record is never written', () => {
  const record = folder({'model-memo.json': {old: 'A', 'old#parts': {p: 1}}, 'record.json': '{"entries":[]}'});
  const out = folder({'model-memo.json': {old: 'CHANGED', 'old#parts': {p: 2}, fresh: 'B', 'fresh#parts': {p: 3}, 'fresh#ms': 900, 'layoutfresh#layout': 'fresh', 'layoutold#layout': 'old'}});
  const before = fs.readFileSync(path.join(record, 'record.json'), 'utf8');
  assert.deepEqual(filledKeys({old: 'A'}, JSON.parse(fs.readFileSync(path.join(out, 'model-memo.json'), 'utf8'))), ['fresh']);
  assert.deepEqual(keepFilled(record, out), ['fresh']);
  const memo = JSON.parse(fs.readFileSync(path.join(record, 'model-memo.json'), 'utf8'));
  assert.equal(memo.old, 'A', 'a kept answer stays as it was');
  assert.deepEqual(memo['old#parts'], {p: 1});
  assert.deepEqual([memo.fresh, memo['fresh#ms'], memo['layoutfresh#layout']], ['B', 900, 'fresh']);
  assert.equal(memo['layoutold#layout'], undefined, 'a note of a kept answer is not copied');
  assert.equal(fs.readFileSync(path.join(record, 'record.json'), 'utf8'), before, 'the network record is never touched');
});

test('a replay that asked nothing new leaves the memo file as it was', () => {
  const record = folder({'model-memo.json': {old: 'A'}}), out = folder({'model-memo.json': {old: 'A'}});
  const mtime = fs.statSync(path.join(record, 'model-memo.json')).mtimeMs;
  assert.deepEqual(keepFilled(record, out), []);
  assert.equal(fs.statSync(path.join(record, 'model-memo.json')).mtimeMs, mtime);
});

test('replay-net --fill-memo: Mac only, keeps nothing when the privacy tripwire tripped, and the fill reaches the app as memo-only plus fill', () => {
  const net = fs.readFileSync(new URL('../../replay-net.mjs', import.meta.url), 'utf8');
  assert.match(net, /--fill-memo/);
  assert.match(net, /result\.tripped[^\n]*keepFilled|keepFilled[^\n]*tripped/s, 'a tripped run keeps nothing');
  assert.match(net, /fill: FILL/);
  assert.match(fs.readFileSync(new URL('../../lib/offline-app.mjs', import.meta.url), 'utf8'), /JOB_PILOTTO_MODEL_MEMO_FILL: '1'/);
});

test('the network replay serves kept answers loosely (a system-only change still hits) and reports them', () => {
  const net = fs.readFileSync(new URL('../../replay-net.mjs', import.meta.url), 'utf8');
  assert.match(net, /loose: path\.join\(out, 'loose\.jsonl'\)/, 'the loose file reaches the app');
  assert.match(net, /looseHits/);
  assert.match(fs.readFileSync(new URL('../../lib/live-row.mjs', import.meta.url), 'utf8'), /startOfflineApp\(\{ask, fill, loose,/);
});

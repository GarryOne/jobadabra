// A stored record whose pages were saved double-encoded is repaired before it is republished; the record guard then finds nothing, and a clean, labeled or binary body is left alone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {sha} from '../../../lib/net-keep.js';
import {mojibakeBodies} from '../../lib/record-guard.mjs';
import {repairRecordFolder} from '../../lib/record-repair.mjs';

const REAL = Buffer.from('<title>Détail de l\'offre – Genève</title>');
const doubled = Buffer.from(new TextDecoder('windows-1252').decode(REAL), 'utf8');   // what the old recorder stored

function folder(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-repair-')), bodies = path.join(dir, 'bodies');
  fs.mkdirSync(bodies);
  for (const [buf] of entries) fs.writeFileSync(path.join(bodies, sha(buf)), buf);
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({entries: entries.map(([buf, type]) => ({url: `https://x.test/${sha(buf).slice(0, 4)}`, hash: sha(buf), size: buf.length, headers: {'content-type': type}}))}));
  return dir;
}

test('double-encoded bodies get their real bytes, a new hash and size; the guard then finds none; a second pass changes nothing', () => {
  const clean = Buffer.from('{"a":1}'), png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xc3, 0xa9, 0xff]);
  const dir = folder([[doubled, 'text/html'], [clean, 'application/json'], [png, 'image/png']]);
  assert.equal(mojibakeBodies(dir).length, 1, 'the fixture is garbled');
  assert.equal(repairRecordFolder(dir), 1);
  assert.deepEqual(mojibakeBodies(dir), []);
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8'));
  assert.deepEqual([record.entries[0].hash, record.entries[0].size], [sha(REAL), REAL.length]);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'bodies', sha(REAL))), REAL);
  assert.ok(!fs.existsSync(path.join(dir, 'bodies', sha(doubled))), 'the old body is gone');
  assert.deepEqual(record.entries.slice(1).map(entry => entry.hash), [sha(clean), sha(png)], 'clean and binary bodies untouched');
  assert.equal(repairRecordFolder(dir), 0);
});

test('a body shared by two entries (one labeled with a charset, one not) is repaired for the unlabeled one only', () => {
  const dir = folder([[doubled, 'text/html']]);
  const file = path.join(dir, 'record.json'), record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.entries.push({...record.entries[0], url: 'https://x.test/other', headers: {'content-type': 'text/html; charset=utf-8'}});
  fs.writeFileSync(file, JSON.stringify(record));
  assert.equal(repairRecordFolder(dir), 1);
  const after = JSON.parse(fs.readFileSync(file, 'utf8')).entries;
  assert.equal(after[0].hash, sha(REAL));
  assert.equal(after[1].hash, sha(doubled));
  assert.ok(fs.existsSync(path.join(dir, 'bodies', sha(doubled))), 'still needed by the labeled entry');
});

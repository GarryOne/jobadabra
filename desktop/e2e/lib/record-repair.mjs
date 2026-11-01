// Repairs a stored record folder whose kept bodies were saved double-encoded (UTF-8 text read as windows-1252) before the recorder was fixed (c91645b, 15 Oct 2026): the refill republishes
// the row's OLD folder, so the record guard refused it ("kept pages are double-encoded", Aldi, replay-refill run 38819507828). Same definition as the recorder and the guard (repairUnlabeledText).
// Guard: e2e/test/record/record-repair.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {repairUnlabeledText, sha} from '../../lib/net-keep.js';

// A record folder (record.json + bodies/<hash>) -> how many bodies were rewritten. Each repaired body is stored under its new hash, every entry that held the old one points at it,
// and the old file goes when nothing else uses it. A folder with nothing garbled is not touched.
export function repairRecordFolder(dir) {
  const file = path.join(dir, 'record.json'), folder = path.join(dir, 'bodies');
  let record; try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 0; }
  const renamed = new Map();
  for (const entry of record.entries || []) {
    if (!entry.hash) continue;
    const type = entry.headers?.['content-type'] || '', id = `${entry.hash} ${type}`;   // the same body can be labeled in one entry and not in another
    if (!renamed.has(id)) {
      let body; try { body = fs.readFileSync(path.join(folder, entry.hash)); } catch { continue; }
      const real = repairUnlabeledText(body, type);
      renamed.set(id, real === body ? null : {old: entry.hash, hash: sha(real), real});
    }
    const fix = renamed.get(id);
    if (fix) Object.assign(entry, {hash: fix.hash, size: fix.real.length});
  }
  const fixed = [...renamed].filter(([, fix]) => fix);
  if (!fixed.length) return 0;
  for (const [, fix] of fixed) {
    fs.writeFileSync(path.join(folder, fix.hash), fix.real);
    if (!record.entries.some(entry => entry.hash === fix.old)) fs.rmSync(path.join(folder, fix.old), {force: true});
  }
  fs.writeFileSync(file, JSON.stringify(record));
  return fixed.length;
}

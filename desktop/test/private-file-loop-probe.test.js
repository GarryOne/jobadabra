// Probe (try 4 on the Windows EPERM): the real test's loop (a tight-loop reader, a 256 KB file, saves for 1.2 s) with every rename counted. Deleted before ship.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {writePrivate} from '../lib/private-file.js';

test('PROBE the real reader loop, rename tries per save', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-probe-')), 'settings.json');
  const value = n => JSON.stringify({n, pad: 'x'.repeat(256 * 1024)});
  writePrivate(file, value(0));
  const reader = spawn(process.execPath, ['-e', `const fs = require('fs'); let reads = 0; const end = Date.now() + 1500;
    while (Date.now() < end) { reads++; try { fs.readFileSync(${JSON.stringify(file)}, 'utf8'); } catch {} }
    process.stdout.write(String(reads));`]);
  await new Promise(done => reader.on('spawn', done));
  const real = fs.renameSync, saves = [];
  let tries = 0;
  fs.renameSync = (from, to) => { tries++; return real(from, to); };
  try {
    for (let n = 1, end = Date.now() + 1200; Date.now() < end; n++) {
      tries = 0;
      const start = Date.now();
      let result = 'ok';
      try { writePrivate(file, value(n)); } catch (error) { result = error.code; }
      saves.push({tries, ms: Date.now() - start, result});
    }
  } finally { fs.renameSync = real; }
  await new Promise(done => reader.on('exit', done));
  const retried = saves.filter(save => save.tries > 1), failed = saves.filter(save => save.result !== 'ok');
  const histogram = {};
  for (const save of saves) histogram[save.tries] = (histogram[save.tries] || 0) + 1;
  const slowest = Math.max(...saves.map(save => save.ms));
  assert.fail(`PROBE platform=${process.platform} saves=${saves.length} retried=${retried.length} failed=${failed.length} (${[...new Set(failed.map(save => save.result))]}) `
    + `tries-histogram=${JSON.stringify(histogram)} slowest-save=${slowest}ms failed-at-ms=${JSON.stringify(failed.slice(0, 3).map(save => save.ms))}`);
});

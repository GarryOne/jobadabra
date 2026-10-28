// Probe (try 1 on the Windows EPERM): does a reader holding settings.json open for 1.5 s make writePrivate's rename throw, and after how long? Deleted before ship.
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {writePrivate} from '../lib/private-file.js';

for (const hold of [0, 1500]) {
  test(`PROBE writePrivate while another process holds the file open ${hold} ms`, async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-probe-')), 'settings.json');
    writePrivate(file, '{"n":0}');
    const holder = spawn(process.execPath, ['-e', `const fs=require('fs');const fd=fs.openSync(${JSON.stringify(file)},'r');process.stdout.write('open');setTimeout(()=>{fs.closeSync(fd)},${hold});`]);
    await new Promise(done => holder.stdout.once('data', done));
    const start = Date.now();
    let result = 'saved';
    try { writePrivate(file, '{"n":1}'); } catch (error) { result = `threw ${error.code}`; }
    console.log(`PROBE platform=${process.platform} hold=${hold}ms result=${result} after=${Date.now() - start}ms temp-left=${fs.readdirSync(path.dirname(file)).length - 1}`);
    await new Promise(done => holder.on('exit', done));
    assert.fail(`PROBE platform=${process.platform} hold=${hold}ms result=${result} after=${Date.now() - start}ms`);
  });
}

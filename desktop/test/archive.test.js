// Export, import and the automatic backup never block the app (21 Oct 2026: "my cursor was in loading mode, like the app froze"): no main-process file runs tar
// synchronously, a big export reports progress and ends ok while the event loop keeps answering, import reports bytes, and either can be cancelled.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as reset from '../lib/reset.js';
import {createDataJob} from '../lib/data-job.js';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib');
const MAIN = path.join(LIB, '..', 'main.js');

test('no main-process file runs tar synchronously (execFileSync / spawnSync / execSync on tar)', () => {
  const files = [...fs.readdirSync(LIB).filter(name => name.endsWith('.js')).map(name => path.join(LIB, name)), MAIN];
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (/(execFileSync|spawnSync|execSync)\(\s*(tar\(|['"`]tar)/.test(source)) offenders.push(path.relative(LIB, file));
    if (/from '\.\/tar\.js'/.test(source) && /\b(execFileSync|spawnSync|execSync)\b/.test(source)) offenders.push(`${path.relative(LIB, file)} (imports tar and a *Sync runner)`);
  }
  assert.deepEqual(offenders, []);
});

// A fictional data folder: some incompressible 6 MB files, so tar has real work.
function bigFolder(files = 12) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-archive-'));
  const dir = path.join(base, 'Jobadabra');
  fs.mkdirSync(path.join(dir, 'recordings'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"setupDone":true}');
  for (let n = 0; n < files; n++) fs.writeFileSync(path.join(dir, 'recordings', `call-${n}.webm`), crypto.randomBytes(6 * 1024 * 1024));
  return {base, dir};
}

test('a big export reports progress, ends ok, and the event loop keeps answering meanwhile', async () => {
  const {base, dir} = bigFolder();
  const file = path.join(base, 'export.tar.gz');
  const events = [];
  let last = Date.now(), worst = 0, ticks = 0;
  const started = Date.now();
  const ping = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last); last = now; ticks++; }, 10);
  await reset.exportTo(dir, file, {version: 'test', onProgress: event => events.push(event)});
  clearInterval(ping);
  const elapsed = Date.now() - started;
  assert.ok(fs.statSync(file).size > 60 * 1024 * 1024, 'the archive was written');
  // A blocked loop (the old execFileSync tar: worst gap 1.7 s, 9 ticks in 1.8 s) fails both bounds; a loaded CI runner's 250-300 ms hiccup (beta run 6) passes both.
  assert.ok(ticks > 3 && worst < 1000 && ticks > elapsed / 100, `the loop answered during the export (ticks ${ticks} in ${elapsed} ms, worst gap ${worst} ms)`);
  assert.ok(events.length >= 2, 'progress was told');
  assert.deepEqual(events.at(-1), {done: events.at(-1).total, total: events.at(-1).total}, 'ends at 100%');
  assert.ok(events.at(-1).total >= 14, 'counted the folder, the files and the manifest');
  assert.ok(events.every((event, i) => !i || event.done >= events[i - 1].done), 'never goes back');
});

test('import reports the bytes it has read and ends at the file size; a cancel stops it and leaves nothing staged', async () => {
  const {base, dir} = bigFolder(4);
  const file = path.join(base, 'export.tar.gz');
  await reset.exportTo(dir, file, {version: 'test'});
  const events = [];
  await reset.stageImport(dir, file, {onProgress: event => events.push(event)});
  assert.equal(events.at(-1).done, events.at(-1).total);
  assert.equal(events.at(-1).total, fs.statSync(file).size);
  fs.rmSync(`${dir} (import)`, {recursive: true, force: true});
  const controller = new AbortController();
  const running = reset.stageImport(dir, file, {signal: controller.signal, onProgress: () => controller.abort()});
  await assert.rejects(running, error => error.code === 'cancelled');
  assert.ok(!fs.existsSync(`${dir} (import)`), 'the half-unpacked folder is removed');
});

test('a cancelled export removes its half-written file', async () => {
  const {base, dir} = bigFolder(4);
  const file = path.join(base, 'export.tar.gz');
  const controller = new AbortController();
  const running = reset.exportTo(dir, file, {signal: controller.signal, onProgress: ({done}) => { if (done > 0) controller.abort(); }});
  await assert.rejects(running, error => error.code === 'cancelled');
  assert.ok(!fs.existsSync(file));
  assert.deepEqual(fs.readdirSync(dir).filter(name => /manifest|keys|accounts|snapshot/.test(name)), [], 'the temporary files in the folder are gone');
});

test('the data job runs one at a time, tells the window each state, and passes the cancel on', async () => {
  const sent = [];
  const {dataJob: job} = createDataJob({toWindow: (channel, event) => sent.push([channel, event])});
  let finish;
  const first = job.run('export', ({onProgress}) => new Promise(resolve => { onProgress({done: 1, total: 4}); finish = resolve; }));
  assert.equal(job.running(), 'export');
  await assert.rejects(job.run('backup', async () => 'x'), /already running/);
  finish('ok');
  assert.equal(await first, 'ok');
  assert.equal(job.running(), null);
  assert.deepEqual(sent.map(([, event]) => `${event.kind}:${event.state}`), ['export:running', 'export:running', 'export:done']);
  const cancelled = job.run('import', ({signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), {code: 'cancelled'})))));
  assert.equal(job.cancel(), true);
  await assert.rejects(cancelled);
  assert.equal(sent.at(-1)[1].state, 'cancelled');
});

// Quitting must never leave a tar child holding the data folder (Windows settings suite: "the data folder is held after the app exits").
import {liveTars} from '../lib/archive.js';
import * as critical from '../lib/critical.js';

test('dataJob.stop cancels a running export, awaits its tar, and leaves no child process and no half file', async () => {
  const {base, dir} = bigFolder(12);
  const file = path.join(base, 'export.tar.gz');
  const events = [];
  const job = createDataJob({toWindow: (_, event) => events.push(event)}).dataJob;
  const running = job.run('export', options => reset.exportTo(dir, file, {version: 'test', ...options})).catch(error => error);
  for (let waited = 0; liveTars() === 0 && waited < 5000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(liveTars(), 1, 'tar is running');
  assert.deepEqual(critical.labels(), ['Exporting your data'], 'quit would ask about it');
  assert.equal(job.running(), 'export');
  assert.equal(await job.stop(), true);
  assert.equal(liveTars(), 0, 'no tar child remains once stop() returned');
  assert.equal((await running).code, 'cancelled');
  assert.equal(fs.existsSync(file), false, 'the half-written file is removed');
  assert.equal(job.running(), null);
  assert.deepEqual(critical.labels(), []);
  assert.equal(await job.stop(), false, 'nothing to stop');
  fs.rmSync(base, {recursive: true, force: true});   // the folder is free (Windows would refuse while a tar held it)
  assert.equal(fs.existsSync(base), false);
});

test('a cancelled import leaves the data folder as it was and nothing staged', async () => {
  const {base, dir} = bigFolder(8);
  const file = path.join(base, 'export.tar.gz');
  await reset.exportTo(dir, file, {version: 'test'});
  const before = fs.readdirSync(dir).sort();
  const job = createDataJob({toWindow: () => {}}).dataJob;
  const running = job.run('import', options => reset.stageImport(dir, file, options)).catch(error => error);
  for (let waited = 0; liveTars() === 0 && waited < 5000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10));
  await job.stop();
  assert.equal((await running).code, 'cancelled');
  assert.equal(liveTars(), 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'no marker, nothing replaced');
  assert.equal(fs.existsSync(`${dir} (import)`), false);
  fs.rmSync(base, {recursive: true, force: true});
});

// GNU tar's exit 1 for "file changed as we read it" is a finished backup of a live folder; every other failure still fails (settings suite, main 21:47 on 25 Oct 2026).
test('a pack whose files changed while it was read is finished; a real tar failure is not', async () => {
  const {tarFinished} = await import('../lib/archive.js');
  assert.equal(tarFinished(0, ''), true);
  assert.equal(tarFinished(1, 'tar: data: file changed as we read it'), true);
  assert.equal(tarFinished(1, 'tar: data/x: Cannot open: Permission denied\ntar: data: file changed as we read it'), false);
  assert.equal(tarFinished(1, 'tar: x: Cannot stat: No such file or directory'), false);
  assert.equal(tarFinished(2, 'tar: data: file changed as we read it'), false);
});

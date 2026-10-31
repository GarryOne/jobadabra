// The Playwright report runner never hangs a CI job after the suite decided its code (lib/report.mjs closeOrStop; 6 Oct 2026: wander passed, then hung 10 min).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import vm from 'node:vm';
import {closeOrStop, codeFrom} from '../lib/report.mjs';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-report-test-')), 'code');
const node = script => spawn(process.execPath, ['-e', script], {stdio: 'ignore'});

test('a runner that stays open after the suite wrote its code is stopped, and the suite\'s own code is kept', async () => {
  const file = tmpFile(), lines = [];
  const child = node(`require('fs').writeFileSync(${JSON.stringify(file)}, '0'); setInterval(() => {}, 1000);`);   // decides, then never exits
  const started = Date.now();
  const exitCode = await closeOrStop(child, file, {graceMs: 300, pollMs: 50, log: line => lines.push(line)});
  assert.equal(exitCode, null);
  assert.ok(Date.now() - started < 5000, 'stopped within the grace, not left to the hard stop');
  assert.match(lines.join('\n'), /still open .* stopped/);
  assert.equal(codeFrom(file, exitCode), 0, 'the suite passed: a pass, not a crash');
  await new Promise(done => (child.exitCode !== null || child.signalCode ? done() : child.on('exit', done)));
});

test('a runner that closes on its own is waited for, never stopped, and a suite that never decided is no pass', async () => {
  const file = tmpFile(), lines = [];
  const exitCode = await closeOrStop(node(`setTimeout(() => process.exit(3), 400);`), file, {graceMs: 100, pollMs: 50, log: line => lines.push(line)});
  assert.equal(exitCode, 3, 'no code file: the grace never starts, however long the runner takes');
  assert.deepEqual(lines, []);
  assert.equal(codeFrom(file, exitCode), 3);
});

// Exercise the private trace writer with its real filesystem operations and a controlled deadline; no Electron is launched.
function traceWriter(t, tracing) {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-trace-test-'));
  t.after(() => fs.rmSync(artifacts, {recursive: true, force: true}));
  let expire;
  const source = fs.readFileSync(new URL('../lib/app.mjs', import.meta.url), 'utf8');
  const traceCode = source.slice(source.indexOf('let traces = 0;'), source.indexOf('// Which wizard step'))
    .replace('export const traceFiles', 'const traceFiles');
  const start = vm.runInNewContext(`${traceCode}; startTrace;`, {fs, os, path, ARTIFACTS: artifacts, process,
    console: {log() {}}, setTimeout: fn => { expire = fn; return {unref() {}}; }, clearTimeout() {}});
  return {artifacts, start: () => start({context: () => ({tracing})}, {E2E_SUITE: 'apply'}), expire: () => expire()};
}

test('a trace stop past its deadline never publishes a partial or late trace', async t => {
  let finish, writing;
  const harness = traceWriter(t, {start: async () => {}, stop: ({path: file}) => {
    writing = file;
    fs.writeFileSync(file, 'PK unfinished trace');
    return new Promise(resolve => { finish = () => { fs.appendFileSync(file, ' completed'); resolve(); }; });
  }});
  const trace = await harness.start(), final = path.join(harness.artifacts, 'trace-apply.zip');
  const stopping = trace.stop(true);
  harness.expire();
  await stopping;
  assert.equal(fs.existsSync(final), false, 'the upload must never see a timed-out trace');
  assert.equal(path.relative(harness.artifacts, writing).startsWith('..'), true, 'the scanner and artifact directory glob cannot pick up staging bytes');
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.existsSync(final), false, 'a late stop cannot publish after the scan');
  assert.equal(fs.existsSync(writing), false, 'late completion cleans up its staging file');
});

test('a completed trace is published only after stop finishes', async t => {
  let finish;
  const harness = traceWriter(t, {start: async () => {}, stop: ({path: file}) => {
    fs.writeFileSync(file, 'complete trace');
    return new Promise(resolve => { finish = resolve; });
  }});
  const trace = await harness.start(), final = path.join(harness.artifacts, 'trace-apply.zip');
  const stopping = trace.stop(true);
  assert.equal(fs.existsSync(final), false);
  finish();
  await stopping;
  assert.equal(fs.readFileSync(final, 'utf8'), 'complete trace');
});

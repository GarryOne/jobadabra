// Preserve delayed extension timestamps and bracket awaited work without a browser, app, network or real storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {logTo} from '../lib/log.js';
import {logText} from './log-text.mjs';

// The real server environment and file logger run; only service boundaries imported by server-env are inert.
async function serverLog(t) {
  const file = new URL('../lib/server-env.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const stubs = new Map();
  for (const [, names, relative] of source.matchAll(/import \{([^}]+)\} from '([^']+)'/g)) {
    if (relative === './log.js') continue;
    stubs.set(new URL(relative, file).href, names.split(',').map(name => {
      const parts = name.trim().split(/\s+as\s+/);
      return `export const ${parts[0]} = () => {};`;
    }).join('\n'));
  }
  for (const [, relative] of source.matchAll(/import \* as \w+ from '([^']+)'/g)) {
    stubs.set(new URL(relative, file).href, relative === './notion-gate.js'
      ? 'export const notionInUse = () => false; export const tracking = () => false;'
      : 'export const setStatus = () => {}; export const MODELS = {kit: \'fixture\'};');
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const target = context.parentURL && new URL(specifier, context.parentURL).href;
      return stubs.has(target) ? {url: target, shortCircuit: true} : next(specifier, context);
    },
    load(url, context, next) {
      return stubs.has(url) ? {format: 'module', source: stubs.get(url), shortCircuit: true} : next(url, context);
    },
  });
  t.after(() => hooks.deregister());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-span-log-'));
  t.after(() => { logTo(null); fs.rmSync(dir, {recursive: true, force: true}); });
  logTo(dir);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('network forbidden'); });
  const {localEnv} = await import('../lib/server-env.js');
  return {onLog: localEnv({settings: () => ({}), secret: () => 'isolated-token'}).onLog,
    lines: () => logText(path.join(dir, 'app.log')).trim().split('\n')};
}

test('a delayed extension entry retains its source time and receipt time without changing the greppable prefix', async t => {
  const log = await serverLog(t);
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-30T00:02:00.000Z')});
  log.onLog([{at: '2026-10-30T00:00:00.000Z', kind: 'span', text: 'askPage end', fields: {ms: 70000}}]);
  const [line] = log.lines();
  assert.match(line, /^2026-10-30T00:02:00.000Z \[extension\] span: askPage end /);
  assert.deepEqual(JSON.parse(line.slice(line.indexOf('{'))), {
    ms: 70000, extensionAt: '2026-10-30T00:00:00.000Z', receivedAt: '2026-10-30T00:02:00.000Z',
  });
  log.onLog([{at: '2026-10-30T00:01:59.000Z', kind: 'fill', text: 'page kind: form', fields: {ms: 37}}]);
  assert.deepEqual(JSON.parse(log.lines()[1].split('form ')[1]), {ms: 37, extensionAt: '2026-10-30T00:01:59.000Z'});
});

test('a slow await logs paired measured spans, including rejection, without waiting for the log queue', async t => {
  let kept = {}, writes = 0, now = 1000;
  const sent = [];
  const oldChrome = globalThis.chrome;
  t.after(() => { if (oldChrome === undefined) delete globalThis.chrome; else globalThis.chrome = oldChrome; });
  globalThis.chrome = {runtime: {getManifest: () => ({version: '0.9'})}, storage: {local: {
    get: async () => kept, set: async patch => { writes++; kept = structuredClone({...kept, ...patch}); },
  }}};
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (_url, init) => { sent.push(...JSON.parse(init.body).entries); return {ok: true}; });
  const flow = new URL('../../extension/flow.js', import.meta.url).href;
  const hooks = registerHooks({
    load(url, context, next) {
      return url === flow ? {format: 'module', source: "export const settings = async () => ({workerUrl: 'http://isolated.invalid', token: 'fake'});", shortCircuit: true} : next(url, context);
    },
  });
  t.after(() => hooks.deregister());
  const {span, pushDecisions} = await import('../../extension/log.js');
  assert.equal(typeof span, 'function', 'the production span helper must exist');
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  let called = false;
  const pending = span('askPage tab=7', () => { called = true; return slow; });
  assert.equal(called, true, 'log writes must not delay starting the await');
  await pushDecisions();
  assert.equal(kept['jp-decisions'].at(-1).text, 'askPage tab=7 start');
  now = 121000; release('form');
  assert.equal(await pending, 'form');
  await pushDecisions();
  const pair = kept['jp-decisions'].slice(-2);
  assert.deepEqual(pair.map(entry => [entry.kind, entry.text]), [['span', 'askPage tab=7 start'], ['span', 'askPage tab=7 end']]);
  assert.equal(pair[1].fields.ms, 120000);
  assert.equal(pair[0].fields.id, pair[1].fields.id);
  const error = new Error('private value never logged');
  await assert.rejects(span('askKind labels', async () => { now += 500; throw error; }), value => value === error);
  await pushDecisions();
  const failed = kept['jp-decisions'].at(-1);
  assert.equal(failed.text, 'askKind labels end');
  assert.equal(failed.fields.ms, 500);
  assert.equal(failed.fields.failed, true);
  assert.doesNotMatch(JSON.stringify(sent), /private value/);
  assert.ok(writes > 0, 'span entries travel through the existing decision queue');
  await pushDecisions();
  await pushDecisions();
});

test('a burst of lines past one batch reaches the app oldest first, none dropped, and only delivered lines are marked sent', async t => {
  let kept = {}, reachable = false;
  const sent = [];
  const oldChrome = globalThis.chrome;
  t.after(() => { if (oldChrome === undefined) delete globalThis.chrome; else globalThis.chrome = oldChrome; });
  globalThis.chrome = {runtime: {getManifest: () => ({version: '0.9'})}, storage: {local: {
    get: async () => kept, set: async patch => { kept = structuredClone({...kept, ...patch}); },
  }}};
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (!reachable) throw new Error('app closed');
    sent.push(...JSON.parse(init.body).entries);
    return {ok: true};
  });
  const flow = new URL('../../extension/flow.js', import.meta.url).href;
  const hooks = registerHooks({
    load(url, context, next) {
      return url === flow ? {format: 'module', source: "export const settings = async () => ({workerUrl: 'http://isolated.invalid', token: 'fake'});", shortCircuit: true} : next(url, context);
    },
  });
  t.after(() => hooks.deregister());
  const {decide, pushDecisions} = await import('../../extension/log.js');
  for (let i = 0; i < 60; i++) await decide('span', `step ${i}`);   // one fill pass writes about 30 span lines while the app is slow or closed
  await pushDecisions();   // every push queued by the writes above has failed before the app comes back
  assert.equal(kept['jp-decisions'].length, 60, 'the ring keeps a whole burst: the line that names the slow await is never pushed out');
  reachable = true;
  await pushDecisions();
  assert.deepEqual(sent.map(entry => entry.text), Array.from({length: 20}, (_, i) => `step ${i}`), 'the oldest batch goes first');
  assert.equal(kept['jp-decisions'].filter(entry => entry.sent).length, 20, 'lines that were not in the delivered batch stay unsent');
  await pushDecisions();
  await pushDecisions();
  assert.deepEqual(sent.map(entry => entry.text), Array.from({length: 60}, (_, i) => `step ${i}`));
  assert.equal(kept['jp-decisions'].filter(entry => !entry.sent).length, 0);
});

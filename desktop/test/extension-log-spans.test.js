// Preserve delayed extension timestamps and bracket awaited work without a browser, app, network or real storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {logTo} from '../lib/log.js';
import {logText} from './log-text.mjs';

let fresh = 0;   // the log keeps its lines in module memory: each test imports its own copy (a query makes it a new module)

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
  const {span, pushDecisions: push, crashCopyWritten} = await import(`../../extension/log.js?fresh=${++fresh}`);
  const pushDecisions = async () => { await push(); await crashCopyWritten(); };
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

// Only storage, configuration and transport are fake; each test runs the real log owner.
async function extensionLog(t, reply, {serial = false, kept: start = []} = {}) {
  let kept = start.length ? {'jp-decisions': start} : {};
  // serial: one storage backend handling one operation at a time, as the browser does; `ops` counts them, `done` counts the finished ones.
  const stats = {ops: 0, done: 0};
  let tail = Promise.resolve();
  const once = work => serial ? (tail = tail.then(async () => { stats.ops++; await new Promise(resolve => setTimeout(resolve, 1)); const out = work(); stats.done++; return out; })) : Promise.resolve(work());
  const batches = [];
  const oldChrome = globalThis.chrome;
  t.after(() => { if (oldChrome === undefined) delete globalThis.chrome; else globalThis.chrome = oldChrome; });
  globalThis.chrome = {runtime: {getManifest: () => ({version: '0.9'})}, storage: {local: {
    get: () => once(() => structuredClone(kept)), set: patch => once(() => { kept = structuredClone({...kept, ...patch}); }),
  }}};
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const batch = JSON.parse(init.body).entries;
    batches.push(batch);
    await new Promise(resolve => setTimeout(resolve, 0));
    return reply ? reply(batch, batches.length) : {ok: true};
  });
  const flow = new URL('../../extension/flow.js', import.meta.url).href;
  const hooks = registerHooks({
    load(url, context, next) {
      return url === flow ? {format: 'module', source: "export const settings = async () => ({workerUrl: 'http://isolated.invalid', token: 'fake'});", shortCircuit: true} : next(url, context);
    },
  });
  t.after(() => hooks.deregister());
  const log = await import(`../../extension/log.js?fresh=${++fresh}`);
  // Why (beta 41215677698, 31 Oct 2026): a test ends only once its own log has stopped sending (joining the drain sends what is left to THIS test's stub), so no
  // batch of an ended test reaches the next test's fetch stub; a drain that outlives 2 s fails its own test instead of leaking. Test: "never posts into the next".
  t.after(() => Promise.race([log.pushDecisions(), new Promise((_, reject) => setTimeout(() => reject(new Error('this test\'s log was still sending 2 s after it ended')), 2000).unref())]));
  // pushDecisions never waits for storage (Gitar on #2673); a test that reads the crash copy waits for it explicitly. rawPush is the push itself.
  return {...log, rawPush: log.pushDecisions, pushDecisions: async () => { await log.pushDecisions(); await log.crashCopyWritten(); }, batches, stats, kept: () => kept['jp-decisions'] || []};
}

for (const failure of ['non-ok', 'rejected']) test(`a ${failure} POST leaves the burst unsent and one later push drains every line oldest first`, async t => {
  const log = await extensionLog(t, (_batch, n) => {
    if (n === 1 && failure === 'rejected') throw new Error('app closed');
    return {ok: n !== 1, status: n === 1 ? 500 : 200};
  });
  const pending = Array.from({length: 60}, (_, i) => log.decide('span', `step ${i}`));
  pending.push(log.decide('fill', 'page kind corrected: form'));
  await Promise.all(pending);
  // Join the first automatic push rather than requesting a retry after it has failed.
  await log.pushDecisions();
  assert.equal(log.batches.length, 1, 'a failed push stops without retrying its dirty follow-up');
  assert.equal(log.kept().length, 61, 'the unchanged ring retains the whole burst');
  assert.equal(log.kept().filter(entry => entry.sent).length, 0, 'a failed response marks nothing sent');
  await log.pushDecisions();
  assert.deepEqual(log.batches.slice(1).flat().map(entry => entry.text), [...Array.from({length: 60}, (_, i) => `step ${i}`), 'page kind corrected: form']);
  assert.ok(log.batches.every(batch => batch.length <= 50));
  assert.equal(log.kept().filter(entry => !entry.sent).length, 0);
});

test('a busy app receives a back-to-back span burst and its product line in at most four POSTs', async t => {
  const {decide, pushDecisions, batches, kept} = await extensionLog(t);
  const pending = Array.from({length: 60}, (_, i) => decide('span', `step ${i}`));
  const product = "page kind corrected: a posting with no Apply but a form's fields";
  pending.push(decide('fill', product));
  await Promise.all(pending);
  await pushDecisions();
  t.diagnostic(`back-to-back burst POST count: ${batches.length}`);
  assert.ok(batches.length <= 4, `expected at most 4 POSTs, got ${batches.length}`);
  assert.ok(batches.every(batch => batch.length <= 50), 'the route keeps at most 50 entries per POST');
  assert.deepEqual(batches.flat().map(entry => entry.text), [...Array.from({length: 60}, (_, i) => `step ${i}`), product]);
  assert.equal(kept().filter(entry => entry.sent).length, 61);
});

test('writes during a busy POST coalesce instead of waiting for one POST per line', async t => {
  const log = await extensionLog(t);
  // Await persistence only: the automatic push remains in flight during the next writes.
  for (let i = 0; i < 60; i++) await log.decide('span', `step ${i}`);
  const product = "page kind corrected: a posting with no Apply but a form's fields";
  await log.decide('fill', product);
  const owner = log.rawPush();
  const followers = Array.from({length: 60}, () => log.rawPush());
  await owner;
  t.diagnostic(`interleaved burst POST count: ${log.batches.length}`);
  assert.ok(log.batches.length <= 4, `expected at most 4 POSTs, got ${log.batches.length}`);
  assert.ok(followers.every(promise => promise === owner), 'running calls share one owner and follow-up');
  assert.deepEqual(log.batches.flat().map(entry => entry.text), [...Array.from({length: 60}, (_, i) => `step ${i}`), product]);
  assert.ok(log.batches.every(batch => batch.length <= 50));
  assert.equal(log.kept().filter(entry => entry.sent).length, 61);
});

test('a later failed batch marks only its successful predecessor and retries only the remainder', async t => {
  const log = await extensionLog(t, (_batch, n) => ({ok: n !== 2, status: n === 2 ? 500 : 200}));
  await Promise.all(Array.from({length: 61}, (_, i) => log.decide('span', `step ${i}`)));
  await log.pushDecisions();
  assert.equal(log.batches.length, 2);
  assert.deepEqual(log.kept().map(entry => entry.sent), [...Array(50).fill(true), ...Array(11).fill(false)]);
  await log.pushDecisions();
  assert.deepEqual(log.batches[2].map(entry => entry.text), Array.from({length: 11}, (_, i) => `step ${50 + i}`));
  assert.equal(log.kept().filter(entry => !entry.sent).length, 0);
});

// Beta 41090972183 (#2608): the push stalled 14-62 s while every other call to the app was fast; a slow cycle says which phase took the time.
for (const outcome of ['ok', 'failed']) test(`a push cycle of 5 s or more (${outcome}) writes one "slow push" line naming the POST as the slow phase`, async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const log = await extensionLog(t, (_batch, n) => {
    if (n === 1) { now += 6000; return {ok: outcome === 'ok', status: outcome === 'ok' ? 200 : 503}; }
    return {ok: true};
  });
  await log.decide('fill', 'page kind corrected: form');
  await log.pushDecisions();
  await log.pushDecisions();
  const slow = log.kept().filter(entry => entry.text === 'slow push');
  assert.equal(slow.length, 1, 'one line for the one slow cycle');
  const {version: _version, ...fields} = slow[0].fields;
  assert.deepEqual(fields, {settingsMs: 0, readMs: 0, postMs: 6000, lines: 1, ...(outcome === 'ok' ? {markMs: 0} : {failed: true})});
  assert.ok(log.batches.flat().some(entry => entry.text === 'slow push'), 'the line itself reaches the app with a later push');
});

test('a fast push writes no "slow push" line', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const log = await extensionLog(t, () => { now += 4999; return {ok: true}; });
  await log.decide('fill', 'filled the form');
  await log.pushDecisions();
  assert.equal(log.kept().filter(entry => entry.text === 'slow push').length, 0);
});

test('while the app stays slow, a cycle that carried only a "slow push" note writes no new note and the drain ends (Gitar on #2612)', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const log = await extensionLog(t, () => { now += 6000; return {ok: true}; });
  await log.decide('fill', 'filled the form');
  await log.pushDecisions();
  await log.pushDecisions();
  assert.equal(log.kept().filter(entry => entry.text === 'slow push').length, 1, 'one note for the one slow cycle of real lines');
  assert.equal(log.batches.length, 2, 'the real line, then its note; no third POST for a note about the note');
  assert.equal(log.kept().filter(entry => !entry.sent).length, 0);
});

// Owner, 31 Oct 2026 ("Evidence first"; run 41162490590): a 24-lines/s burst made the log queue behind itself (read 10.7 s, mark 13.6 s, POST 18 ms) and the app got lines up to 184 s late.
test('a 120-line burst costs a handful of storage operations, and a read made during it is not queued behind the lines', async t => {
  const log = await extensionLog(t, undefined, {serial: true});
  const burst = Promise.all(Array.from({length: 120}, (_, i) => log.decide('span', `step ${i}`)));
  await new Promise(resolve => setTimeout(resolve, 15));
  const issued = log.stats.done;
  await globalThis.chrome.storage.local.get('config');   // what settings() and every other storage user does
  const ahead = log.stats.done - issued;
  await burst;
  await log.pushDecisions();
  t.diagnostic(`storage operations for 120 lines: ${log.stats.ops}; operations ahead of a concurrent read: ${ahead}`);
  assert.ok(log.stats.ops <= 12, `expected a handful of storage operations, got ${log.stats.ops} (one get+set per line before the change)`);
  assert.ok(ahead <= 3, `a read made during the burst waited behind ${ahead} operations`);
  assert.equal(log.kept().length, 120);
  assert.equal(log.kept().filter(entry => entry.sent).length, 120);
});

test('lines that would be pushed out of a full ring unsent leave one "log dropped N" line, never a silent gap', async t => {
  const log = await extensionLog(t, () => { throw new Error('app closed'); });
  await Promise.all(Array.from({length: 260}, (_, i) => log.decide('span', `step ${i}`)));
  const kept = log.kept(), marker = kept.find(entry => /^log dropped \d+$/.test(entry.text));
  assert.ok(kept.length <= 200, `the ring stays at 200, got ${kept.length}`);
  assert.ok(marker, 'the loss is written down');
  const steps = kept.filter(entry => /^step /.test(entry.text));
  assert.equal(steps.at(-1).text, 'step 259', 'the newest line is kept');
  assert.equal(steps.length + marker.fields.lost, 260, 'every line is either kept or counted');
});

test('the first line after a worker restart says how long the log had been silent, and names this worker\'s log', async t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-31T03:21:48.000Z')});
  const log = await extensionLog(t, undefined, {kept: [{at: '2026-10-31T03:20:27.500Z', kind: 'fill', text: 'last line of the old worker', fields: {}, sent: true}]});
  await log.decide('worker', 'worker started again in the same browser run');
  await log.decide('fill', 'second line');
  const [old, first, second] = log.kept();
  assert.equal(old.text, 'last line of the old worker');
  assert.equal(first.fields.sinceLastLineMs, 80500);
  assert.match(first.fields.logBoot, /^[a-z0-9]{6,}$/);
  assert.equal(second.fields.sinceLastLineMs, undefined, 'only the first line of a worker carries it');
});

// Review of this change (31 Oct 2026): the three ways the first version missed its own purpose.
test('the restart stamp lands in the real boot order: a push has already read the crash copy when the worker\'s first line is written', async t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-31T03:21:48.000Z')});
  const log = await extensionLog(t, undefined, {kept: [{at: '2026-10-31T03:20:27.500Z', kind: 'fill', text: 'old', fields: {}, sent: true}]});
  await log.pushDecisions();   // background.js:41 pushes at module load, before any line
  await log.decide('worker', 'worker started again in the same browser run');
  assert.equal(log.kept()[1].fields.sinceLastLineMs, 80500);
  assert.ok(log.kept()[1].fields.logBoot);
});

test('lines trickling in with the app closed keep one "log dropped" line and nearly the whole ring', async t => {
  const log = await extensionLog(t, () => { throw new Error('app closed'); });
  for (let i = 0; i < 400; i++) await log.decide('fill', `line ${i}`);
  const kept = log.kept(), markers = kept.filter(entry => /^log dropped \d+$/.test(entry.text));
  assert.ok(kept.length <= 200);
  assert.equal(markers.length, 1, 'one marker, updated in place');
  assert.equal(kept.filter(entry => /^line /.test(entry.text)).length + markers[0].fields.lost, 400, 'every line is kept or counted');
  assert.ok(kept.length >= 199, `the ring is used in full, got ${kept.length}`);
});

test('a caller waits for the write that holds its own line, not for the lines that arrive after it', async t => {
  const log = await extensionLog(t);
  const real = globalThis.chrome.storage.local.set, gates = [];
  globalThis.chrome.storage.local.set = patch => new Promise(resolve => gates.push(() => resolve(real(patch))));
  const first = log.decide('fill', 'A');
  await new Promise(resolve => setTimeout(resolve, 5));
  let secondDone = false;
  const second = log.decide('fill', 'B').then(() => { secondDone = true; });
  gates.shift()();
  await first;
  assert.equal(secondDone, false, 'the first caller did not wait for the second line\'s write');
  while (!secondDone) { await new Promise(resolve => setTimeout(resolve, 1)); gates.shift()?.(); }
  await second;
});

test('a stalled storage cannot grow the ring in memory without bound', async t => {
  const log = await extensionLog(t);
  globalThis.chrome.storage.local.set = () => new Promise(() => {});
  for (let i = 0; i < 2000; i++) log.decide('span', `step ${i}`).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 5));
  await Promise.race([log.pushDecisions(), new Promise(resolve => setTimeout(resolve, 20))]);
  assert.ok(log.batches.flat().length <= 300, `the stalled ring stayed bounded, pushed ${log.batches.flat().length}`);
});

test('a storage write that never settles does not stop the drain: every batch is still delivered (Gitar on #2673)', async t => {
  const log = await extensionLog(t);
  globalThis.chrome.storage.local.set = () => new Promise(() => {});
  for (let i = 0; i < 120; i++) log.decide('span', `step ${i}`).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 5));
  await Promise.race([log.rawPush(), new Promise((_, reject) => setTimeout(() => reject(new Error('the drain waited for a write that never settles')), 500))]);
  assert.equal(log.batches.flat().length, 120, 'all 120 lines reached the app while storage hung');
});

// Beta 41215677698 (31 Oct 2026, Mac build): the test above got 170 lines, not 120. The test before it ended while its log was still sending, and on the slow
// runner that log's next batch of 50 went to the fetch stub of the next test. Code unchanged since its last green (#2700's PR run): flaky, by test isolation.
test('a log whose test has ended never posts into the next test\'s stub', async t => {
  await t.test('a drain still sending when its test ends', async st => {
    const log = await extensionLog(st, async () => { await new Promise(resolve => setTimeout(resolve, 30)); return {ok: true}; });
    for (let i = 0; i < 120; i++) log.decide('span', `old ${i}`).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 5));   // its first batch is in flight when the test ends
  });
  await t.test('the next test sees only its own lines', async st => {
    const log = await extensionLog(st);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(log.batches.flat().map(entry => entry.text), [], 'no line of the ended test reached this stub');
  });
});

// #2673 red (page cases, required-salutation-menu-1): recorded cases' "told" words match the POSTed text, whose keys chrome.storage used to return sorted.
test('lines go to the app with their keys sorted at every depth, as when they were read back from storage; arrays keep their order', async t => {
  const log = await extensionLog(t);
  await log.decide('fill', 'fields: 1 filled', {url: 'https://x.test/a', fields: [{label: 'Title', type: 'combobox', required: true, outcome: 'left', source: '', reason: 'demographic: your own choice'}, {label: 'First', outcome: 'filled'}]});
  await log.pushDecisions();
  const [entry] = log.batches[0];
  assert.deepEqual(Object.keys(entry), ['at', 'fields', 'kind', 'sent', 'text']);
  assert.match(JSON.stringify(entry.fields), /"fields":\[\{"label":"Title","outcome":"left","reason":"demographic: your own choice","required":true,"source":"","type":"combobox"\},\{"label":"First","outcome":"filled"\}\],"logBoot":"[a-z0-9]+","url"/);
});

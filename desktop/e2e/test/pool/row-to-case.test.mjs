// lib/row-to-case.mjs: the whole proof of a row case with its replays injected: the case is written only when the NEW build replays the live run's journey and improves on it (expect from the
// replay, never by hand), the OLD build fails the case (exit 3 when it passes) and replays the live run's page kinds (exit 4 when it does not), and no cold ask is left (exit 4).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {labelMatcher, rowToCase} from '../../lib/row-to-case.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-r2c-'));
const base = {pageKinds: ['page kind: posting {}'], fields: [{label: 'Email', outcome: 'filled', reason: 'your details'}], pressed: []};
const build = async ({name, outDir}) => { const dir = path.join(outDir, name); fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify({replay: 'row', pages: [], baseline: base, expect: {}})); fs.writeFileSync(path.join(dir, 'model-memo.json'), '{}'); return {dir, bytes: 900, verdict: 'ok'}; };
const result = (kinds, extra = {}) => ({appLog: kinds.map(kind => `12:00:00Z [extension] page kind: ${kind} {}`).join('\n'), requests: [{route: '/extension/run', body: JSON.stringify({trace: [{label: 'Email', outcome: 'filled', reason: 'your details'}]})}], misses: 0, unrecorded: [], seconds: 3, divergence: '', ...extra});
const replayBy = (newKinds, oldKinds, extra = {}) => async (dir, options = {}) => result(options.extensionDir ? oldKinds : newKinds, extra);
const go = (replay, extra = {}) => { const outDir = tmp(); return rowToCase({rowDir: '/row', name: 'start-dialog-1', outDir, oldDir: '/old', build, replay, ...extra}).then(done => ({...done, outDir})); };

test('the new build improves and the old build fails: the case is written with the expect the replay derived', async () => {
  const done = await go(replayBy(['posting', 'form'], ['posting']));
  assert.equal(done.code, 0);
  const item = JSON.parse(fs.readFileSync(path.join(done.outDir, 'start-dialog-1', 'case.json'), 'utf8'));
  assert.deepEqual(item.expect, {kinds: ['posting', 'form']});
});

test('exit 3: the old build passes the case (the control proves nothing); nothing is written', async () => {
  const done = await go(replayBy(['posting', 'form'], ['posting', 'form']));
  assert.equal(done.code, 3);
  assert.deepEqual(fs.readdirSync(done.outDir), []);
});

test('exit 4: nothing improved, the old build does not replay the live run\'s page kinds, a cold ask is left, or the new build diverged', async () => {
  assert.match((await go(replayBy(['posting'], ['posting']))).lines.join('\n'), /nothing improved/);
  const old = await go(replayBy(['posting', 'form'], ['form']));
  assert.equal(old.code, 4); assert.match(old.lines.join('\n'), /old build.*does not replay the live run/);
  const cold = await go(replayBy(['posting', 'form'], ['posting'], {misses: 2}));
  assert.equal(cold.code, 4); assert.match(cold.lines.join('\n'), /2 model ask.*--ask-cold/);
  const diverged = await go(replayBy(['posting', 'form'], ['posting'], {divergence: 'press 1: pressed X; live pressed Y'}));
  assert.equal(diverged.code, 4);
});

test('a kept ask with a clock time or a date in its prompt is said as a warning: no memo can match it again', async () => {
  const build2 = async args => { const built = await build(args); fs.writeFileSync(path.join(built.dir, 'model-memo.json'), JSON.stringify({k1: {}, 'k1#volatile': ['user:contact_details']})); return built; };
  const done = await go(replayBy(['posting', 'form'], ['posting']), {build: build2});
  assert.match(done.lines.join('\n'), /WARNING: a kept ask carries a clock time or a date in user:contact_details/);
});

test('--fixed: the live capture was taken on a build that already has the fix: expect is the live run itself, the old build must fail it (and replay the live page kinds); without --fixed that is "nothing improved"', async () => {
  assert.match((await go(replayBy(['posting'], ['posting']))).lines.join('\n'), /nothing improved/);
  const fixed = await go((dir, options = {}) => Promise.resolve(options.extensionDir ? result(['posting'], {requests: []}) : result(['posting'])), {fixed: true});
  assert.match(fixed.lines.join('\n'), /the old build fails it as it must/);
  assert.equal(fixed.code, 0);
  const item = JSON.parse(fs.readFileSync(path.join(fixed.outDir, 'start-dialog-1', 'case.json'), 'utf8'));
  assert.deepEqual(item.expect, {kinds: ['posting'], pressed: [], fields: {Email: 'filled'}}, '--fixed: the outcome only, the reason text is whichever kept answer a replay served');
  const same = await go(replayBy(['posting'], ['posting']), {fixed: true});
  assert.equal(same.code, 3, 'the old build behaves the same: the control proves nothing');
});

test('--fixed: the boxes are expected even when the replay differs from the live run in more than the fix (the old build then fails on the boxes)', async () => {
  const replay = (dir, options = {}) => Promise.resolve(options.extensionDir ? result(['posting'], {boxes: {Prénom: 'empty'}}) : result(['posting'], {boxes: {Prénom: 'filled'}, requests: [{route: '/extension/run', body: JSON.stringify({trace: [{label: 'Email', outcome: 'filled', reason: 'your CV'}]})}]}));
  const done = await go(replay, {fixed: true});
  assert.equal(done.code, 0, done.lines.join(' | '));
  const item = JSON.parse(fs.readFileSync(path.join(done.outDir, 'start-dialog-1', 'case.json'), 'utf8'));
  assert.deepEqual(item.expect.boxes, {Prénom: 'filled'});
  assert.equal(item.expect.fields.Email, 'filled', 'the improvement over the live run is kept too (its outcome)');
});

test('exit 2: a case that exists is not overwritten, the old build is required', async () => {
  const outDir = tmp(); fs.mkdirSync(path.join(outDir, 'start-dialog-1'));
  assert.equal((await rowToCase({rowDir: '/row', name: 'start-dialog-1', outDir, oldDir: '/old', build, replay: replayBy(['a'], ['b'])})).code, 2);
  assert.equal((await go(replayBy(['a'], ['b']), {oldDir: ''})).code, 2);
});

test('--ask-cold: the new build\'s cold asks are kept in the case\'s memo (scrubbed), then it must replay with none', async () => {
  let asked = 0;
  const replay = async (dir, options = {}) => {
    if (options.extensionDir) return result(['posting']);
    if (options.ask) { asked += 1; return result(['posting', 'form'], {memoAfter: {k1: {content: 'anna.muster@gmail.com'}, 'k1#parts': {model: 'abc'}}}); }
    return result(['posting', 'form'], {misses: asked ? 0 : 1});
  };
  const done = await go(replay, {askCold: true});
  assert.equal(done.code, 0);
  assert.equal(asked, 1);
  const memo = fs.readFileSync(path.join(done.outDir, 'start-dialog-1', 'model-memo.json'), 'utf8');
  assert.ok(memo.includes('k1#parts') && !memo.includes('gmail'));
});

test('each stage says so as it starts, in order (a replay is silent for up to 90 s)', async () => {
  const said = [];
  await go(replayBy(['posting', 'form'], ['posting']), {askCold: true, say: line => said.push(line)});
  const order = ['building the case', 'asking the new build', 'replaying on the NEW build (', 'replaying on the OLD build', 'against the written expect'];
  assert.deepEqual(order.map(part => said.findIndex(line => line.includes(part))), [0, 1, 2, 3, 4]);
});

test('--fixed: a live field whose label the replay cannot match (cut or scrubbed in the capture) is not asserted, and the tool says so (the new build failed its own case on it: "field X: absent")', async () => {
  const withCut = async ({name, outDir}) => { const built = await build({name, outDir}); const file = path.join(built.dir, 'case.json'), item = JSON.parse(fs.readFileSync(file, 'utf8'));
    item.baseline = {...base, fields: [...base.fields, {label: 'Current location No location found. Try entering ', outcome: 'left', reason: 'no answer'}]}; fs.writeFileSync(file, JSON.stringify(item)); return built; };
  const done = await go((dir, options = {}) => Promise.resolve(options.extensionDir ? result(['posting'], {requests: []}) : result(['posting'])), {fixed: true, build: withCut});
  assert.equal(done.code, 0, done.lines.join('\n'));
  const item = JSON.parse(fs.readFileSync(path.join(done.outDir, 'start-dialog-1', 'case.json'), 'utf8'));
  assert.deepEqual(Object.keys(item.expect.fields), ['Email'], 'only labels the replay has');
  assert.match(done.lines.join('\n'), /1 live field\(s\) .* not asserted: Current location/);
});

test('a capture label is matched to the replay\'s: the same letters and digits, or a cut start of it; nothing else', () => {
  const match = labelMatcher(['Email✱', 'Current location ✱No location found. Try entering a different locationLoading', 'Phone ✱', 'Full name✱']);
  assert.equal(match('Email'), 'Email✱');
  assert.equal(match('Phone'), 'Phone ✱');
  assert.equal(match('Current location ✱No location found. Try'), 'Current location ✱No location found. Try entering a different locationLoading', 'a cut label');
  assert.equal(match('Name'), undefined, 'a short start is not a match');
  assert.equal(match('Cover letter'), undefined);
});

test('--fixed: a live field matched by label with the same outcome is asserted by its outcome (the reason text is whichever kept answer a replay served)', async () => {
  const worded = async ({name, outDir}) => { const built = await build({name, outDir}); const file = path.join(built.dir, 'case.json'), item = JSON.parse(fs.readFileSync(file, 'utf8'));
    item.baseline = {...base, fields: [{label: 'Email', outcome: 'filled', reason: 'kept in your details'}]}; fs.writeFileSync(file, JSON.stringify(item)); return built; };
  const done = await go((dir, options = {}) => Promise.resolve(options.extensionDir ? result(['posting'], {requests: []}) : result(['posting'])), {fixed: true, build: worded});
  assert.equal(done.code, 0, done.lines.join('\n'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(done.outDir, 'start-dialog-1', 'case.json'), 'utf8')).expect.fields, {Email: 'filled'});
});

test('a field filled live and not now is a regression only where the OLD build\'s replay fills it; --fixed has no regression to find and leaves the field out', async () => {
  const filledLive = async ({name, outDir}) => { const built = await build({name, outDir}); const file = path.join(built.dir, 'case.json'), item = JSON.parse(fs.readFileSync(file, 'utf8'));
    item.baseline = {...base, fields: [...base.fields, {label: 'Gender', outcome: 'filled', reason: 'Female'}]}; fs.writeFileSync(file, JSON.stringify(item)); return built; };
  const trace = rows => ({requests: [{route: '/extension/run', body: JSON.stringify({trace: rows})}]});
  const email = {label: 'Email', outcome: 'filled', reason: 'your details'}, left = {label: 'Gender', outcome: 'left', reason: 'no answer'}, filled = {label: 'Gender', outcome: 'filled', reason: 'Female'};
  const replayOld = oldRows => (dir, options = {}) => Promise.resolve(options.extensionDir ? result(['posting'], oldRows) : result(['posting'], trace([email, left])));
  assert.equal((await go(replayOld(trace([email, filled])), {build: filledLive})).code, 4, 'the old build fills it, the new does not: a regression');
  const noise = await go(replayOld(trace([email, left])), {build: filledLive});
  assert.doesNotMatch(noise.lines.join('\n'), /regressed/, 'the old build does not fill it either: the replay\'s AI answered another way, no regression');
  const done = await go(replayOld(trace([email, filled])), {fixed: true, build: filledLive});
  assert.match(done.lines.join('\n'), /not asserted: Gender/, 'the field the replay\'s AI answered another way is named and left out');
  assert.equal(done.code, 3, 'and with nothing else to tell the builds apart the control proves nothing (the tool says so)');
});

test('the rename a fix makes is asserted: the live (unfixed) label has no replay field, the new label has no live one: the old build fails "absent" in both modes', async () => {
  const unfixed = async ({name, outDir}) => { const built = await build({name, outDir}); const file = path.join(built.dir, 'case.json'), item = JSON.parse(fs.readFileSync(file, 'utf8'));
    item.baseline = {...base, fields: [...base.fields, {label: '18-20', outcome: 'left', reason: 'no answer'}]}; fs.writeFileSync(file, JSON.stringify(item)); return built; };
  const run = rows => ({requests: [{route: '/extension/run', body: JSON.stringify({trace: rows})}]});
  const email = {label: 'Email', outcome: 'filled', reason: 'your details'};
  const replay = (dir, options = {}) => Promise.resolve(options.extensionDir ? result(['posting'], run([email, {label: '18-20', outcome: 'left', reason: 'no answer'}])) : result(['posting'], run([email, {label: 'What is your age range?', outcome: 'left', reason: 'no answer'}])));
  for (const fixed of [true, false]) {
    const done = await go(replay, {fixed, build: unfixed});
    assert.equal(done.code, 0, `fixed=${fixed}: ${done.lines.join('\n')}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(done.outDir, 'start-dialog-1', 'case.json'), 'utf8')).expect.fields['What is your age range?'], fixed ? 'left' : 'left: no answer');
    assert.match(done.lines.join('\n'), /field What is your age range\?: absent/);
  }
});

test('a case that passes at normal speed and not slowed is refused as timing-dependent, with what differed; green at both it is written', async () => {
  const flaky = (dir, options = {}) => Promise.resolve(options.extensionDir ? result(['posting'], {requests: []}) : result(options.slow ? ['posting'] : ['posting', 'form']));
  const refused = await go(flaky);
  assert.equal(refused.code, 4, refused.lines.join('\n'));
  assert.match(refused.lines.join('\n'), /timing-dependent: the new build passes its case at normal speed and not slowed: page kinds: posting, expected posting, form/);
  assert.equal(fs.existsSync(path.join(refused.outDir, 'start-dialog-1')), false, 'nothing written');
  assert.equal((await go(replayBy(['posting', 'form'], ['posting']))).code, 0, 'the same at both speeds: written');
});

test('--ask-cold repeats while the strict replay still misses: the cold replay interleaves differently, so its asks are not all the strict one\'s (up to 3 rounds); when it never settles the tool says so', async () => {
  let colds = 0, strict = 0;
  const settling = async (dir, options = {}) => {
    if (options.ask) { colds += 1; return result(['posting', 'form'], {memoAfter: {['k' + colds]: {content: 'x'}}}); }
    if (options.extensionDir) return result(['posting'], {requests: []});
    strict += 1;
    return result(['posting', 'form'], {misses: strict < 3 ? 1 : 0});
  };
  const done = await go(settling, {askCold: true});
  assert.equal(done.code, 0, done.lines.join('\n'));
  assert.equal(colds, 3, 'asked in 3 rounds');
  assert.match(done.lines.join('\n'), /asked in 3 rounds/);
  colds = 0; strict = 0;
  const never = await go(async (dir, options = {}) => (options.ask ? (colds += 1, result(['posting'], {memoAfter: {}})) : result(['posting', 'form'], {misses: 1})), {askCold: true});
  assert.equal(never.code, 4);
  assert.equal(colds, 3, 'it stops after 3 rounds');
});

test('the page budget the build applied and the pages stubbed are passed through and said in the output', async () => {
  let seen = null;
  const budgeted = async options => { seen = options.stub; const built = await build(options); return {...built, budget: 'page budget: styles cut to layout and visibility, 400 KB -> 250 KB of pages and sheets'}; };
  const done = await go(replayBy(['posting', 'form'], ['posting']), {build: budgeted, stub: [0, 2]});
  assert.equal(done.code, 0, done.lines.join('\n'));
  assert.deepEqual(seen, [0, 2]);
  assert.match(done.lines.join('\n'), /page budget: styles cut to layout and visibility, 400 KB -> 250 KB/);
});

test('a row from reports-fetch (reported-<id>-<site>) writes the report id into the case; any other row writes none', async () => {
  const outDir = tmp();
  const done = await rowToCase({rowDir: '/rows/reported-a1b2c3-example.test', name: 'start-dialog-1', outDir, oldDir: '/old', build, replay: replayBy(['posting', 'form'], ['posting'])});
  assert.equal(done.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, 'start-dialog-1', 'case.json'), 'utf8')).report, 'a1b2c3');
  const plain = await go(replayBy(['posting', 'form'], ['posting']));
  assert.equal(JSON.parse(fs.readFileSync(path.join(plain.outDir, 'start-dialog-1', 'case.json'), 'utf8')).report, undefined);
});

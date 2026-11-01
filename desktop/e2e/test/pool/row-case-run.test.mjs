// lib/row-case-run.mjs: a row case passes when its replay shows its expect, asks no model call the case did not keep, and reaches no unrecorded address. The replay itself is injected.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isRowCase, looseSummary, runRowCase} from '../../lib/row-case-run.mjs';

const item = {name: 'x-1', dir: '/x', replay: 'row', expect: {kinds: ['posting', 'form']}};
const result = (kinds, extra = {}) => ({appLog: kinds.map(kind => `12:00:00Z [extension] page kind: ${kind} {}`).join('\n'), requests: [], misses: 0, unrecorded: [], seconds: 4, ...extra});

test('a row case is told by its replay marker; it passes when the replay shows its expect', async () => {
  assert.ok(isRowCase(item) && !isRowCase({name: 'y'}));
  assert.deepEqual((await runRowCase(item, {replay: async () => result(['posting', 'form'])})).failures, []);
});

test('it fails on the old shape, on a cold ask, on an unrecorded address, and on a case with no expect', async () => {
  assert.match((await runRowCase(item, {replay: async () => result(['posting'])})).failures[0], /page kinds: posting, expected posting, form/);
  assert.match((await runRowCase(item, {replay: async () => result(['posting', 'form'], {misses: 2})})).failures[0], /2 model ask\(s\) not in the case's kept answers/);
  assert.match((await runRowCase(item, {replay: async () => result(['posting', 'form'], {unrecorded: ['https://a.example/x']})})).failures[0], /address not recorded/);
  assert.match((await runRowCase({...item, expect: {}}, {replay: async () => result(['posting'])})).failures[0], /no expect/);
});

test('CI replays a row case LOOSE: the replay is asked for it, a loose hit is a warning line and never a failure, and nothing here checks the capture\'s seed', async () => {
  let asked = null;
  const done = await runRowCase(item, {replay: async (dir, options) => { asked = options; return result(['posting', 'form'], {looseHits: [{differs: ['system:1', 'system:1:search_preferences']}, {differs: ['model', 'system:1']}]}); }});
  assert.equal(asked.loose, true);
  assert.equal(done.ok, true);
  assert.equal(done.loose, '2 answer ask(s) served although the system side differs from the capture\'s: system:1, system:1:search_preferences, model');
  assert.equal(looseSummary([]), '');
  assert.equal((await runRowCase(item, {replay: async () => result(['posting', 'form'])})).loose, '');
});

test('a miss in CI names the parts of the nearest kept ask that differ (the failure line is all CI shows)', async () => {
  const done = await runRowCase(item, {replay: async () => result(['posting', 'form'], {misses: 1, missParts: ['user:Buttons', 'user:line#41'], missVolatile: []})});
  assert.match(done.failures.join('\n'), /the nearest kept ask differs in user:Buttons, user:line#41/);
});

test('a failed replay carries its timeline (swaps and extension lines with times): CI keeps nothing else of it', async () => {
  const done = await runRowCase(item, {replay: async () => result(['posting'], {timeline: ['+0.4s ext: typed 3 boxes', '+3.1s the extension attached a file: the live run\'s next state', '+4.0s ext: typed 3 boxes again']})});
  assert.equal(done.ok, false);
  assert.match(done.failures.at(-1), /replay timeline: \+0\.4s ext: typed 3 boxes \| \+3\.1s the extension attached a file.* \| \+4\.0s ext: typed 3 boxes again/);
  assert.equal((await runRowCase(item, {replay: async () => result(['posting', 'form'], {timeline: ['+1s x']})})).failures.length, 0, 'a green replay says nothing');
});

test('CI\'s row case run says when asks were served by order, and asks the replay for it only on request (the tool\'s own proof never does)', async () => {
  const seen = [];
  const replay = async (dir, options) => { seen.push(options.ordinal === true); return result(['posting', 'form'], {ordinalHits: [{n: 1, of: 2, differs: ['user:job']}]}); };
  const ci = await runRowCase(item, {replay, ordinal: true});
  assert.match(ci.ordinal, /1 ask\(s\) served by ORDER/);
  assert.match(ci.ordinal, /differ from the closest kept ask in user:job/, 'the warning names the parts that differ');
  assert.equal(ci.ok, true, 'a warning, not a failure');
  await runRowCase(item, {replay});
  assert.deepEqual(seen, [true, false]);
});

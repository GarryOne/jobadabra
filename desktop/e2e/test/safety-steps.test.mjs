// A step marked {safety: true} is never suspended: the runner fails it even when lanes.json lists it, suspend-flip refuses to propose it, lanes-check refuses its registry entry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {createRunner} from '../lib/runner.mjs';
import {isSafetyStep, safetyNamesIn, safetyStepNames} from '../lib/safety-steps.mjs';
import {independent} from '../lib/steps.mjs';
import {suspensions} from '../../../tools/suspend-flip.mjs';
import {lanesProblems} from '../../../tools/lanes-check.mjs';

const ISSUE = 'https://github.com/GarryOne/jobadabra/issues/2704';
const listed = {'Stop on the card': {lane: 'suspended', issue: ISSUE}};

test('a safety step listed as suspended still fails the suite, and its result says it is a safety step', async () => {
  const runner = createRunner(() => null, {suspended: listed});
  await assert.rejects(runner.run('Stop on the card', async () => { throw new Error('the job never reached the filling card'); }, {safety: true}));
  assert.equal(runner.results[0].status, 'failed', 'not "suspended": a safety step blocks');
  assert.equal(runner.results[0].safety, true);
  assert.equal(runner.summary(), 1);
});

test('the same step without the mark is still suspended (the rule is the mark, not the name), and a passing safety step carries the mark without "suspended"', async () => {
  const plain = createRunner(() => null, {suspended: listed});
  await plain.run('Stop on the card', async () => { throw new Error('boom'); });
  assert.equal(plain.results[0].status, 'suspended');
  const safe = createRunner(() => null, {suspended: listed});
  await safe.run('Stop on the card', async () => {}, {safety: true});
  assert.equal(safe.results[0].status, 'passed');
  assert.equal(safe.results[0].safety, true);
  assert.equal(safe.results[0].suspended, undefined);
});

test('independent(ctx).step passes the mark on, so a suite using it can mark a safety step too', async () => {
  const seen = [];
  const {step, end} = independent({run: async (name, fn, options) => { seen.push(options); await fn(); }, needs: []});
  await step('a', async () => {}, {safety: true});
  await step('b', async () => {});
  end();
  assert.equal(seen[0].safety, true);
  assert.ok(!seen[1].safety);
});

test('the scan finds marked steps, with literal, concatenated and template names, and nothing else', () => {
  const source = [
    'await ctx.run(\'Stop hands it to you\', async () => { await page.click("#stop"); }, {needs: ctx.needs, safety: true});',
    'await step(`nothing is posted ${mode}`, async () => {}, {safety: true});',
    'await ctx.run(\'reads \\\'a\\\' form: \' + expected + \', nothing is sent\', async () => {}, {safety: true, hangError: hung});',
    'await ctx.run(\'not a safety step\', async () => { const x = {safety: true}; }, {needs: []});',
    'await ctx.run(\'safety in a string\', async () => { log("{safety: true}"); }, {needs: []});',
    '// await ctx.run(\'commented out\', async () => {}, {safety: true});',
    'await ctx.run(\'regex and braces\', async () => { return /\\(+/.test(x) ? `${a}{` : 1; }, {safety: true});',
    'await ctx.run(\'safety false\', async () => {}, {safety: false});',
  ].join('\n');
  assert.deepEqual(safetyNamesIn(source), ['Stop hands it to you', 'nothing is posted ', 'reads \'a\' form: ', 'regex and braces']);
});

test('isSafetyStep matches a step name by the literal start of a marked name', () => {
  const safety = ['Stop on the card', 'reads \'a\' form: '];
  assert.ok(isSafetyStep('Stop on the card in Background automation: nothing is posted', safety));
  assert.ok(isSafetyStep('reads \'a\' form: You review and submit, and nothing is sent', safety));
  assert.ok(!isSafetyStep('Another step', safety));
  assert.ok(!isSafetyStep('Another step', ['']), 'an empty prefix matches nothing');
});

test('suspend-flip refuses to propose a safety step and says why, and proposes the other flaky step', () => {
  const verdict = (step, sha) => ({suite: 'apply', step, verdict: 'flaky', redSha: 'a'.repeat(40), green: {sha, url: 'https://github.com/x/y/actions/runs/1'}, stepFileCount: 3});
  const verdicts = [verdict('Stop on the card in Background automation: nothing is posted', 'b'.repeat(40)), verdict('a plain step', 'c'.repeat(40))];
  const found = suspensions({verdicts, registry: {}, owner: 'GarryOne', safety: ['Stop on the card']});
  assert.deepEqual(found.map(item => item.step), ['a plain step']);
  assert.deepEqual(found.refused.map(item => item.step), ['Stop on the card in Background automation: nothing is posted']);
  assert.match(found.refused[0].why, /safety step.*never suspended.*blocks.*fixed the same day/s);
});

test('lanes-check refuses a steps entry for a safety step, changed or not, and accepts the rest', () => {
  const entry = {lane: 'suspended', since: '2026-10-31', owner: 'GarryOne', issue: ISSUE, returns: 'Back to the backbone when its fix lands.', why: 'Red on one commit and green on the same commit two minutes earlier.', input: 'the hidden Chrome'};
  const text = JSON.stringify({suites: {}, steps: {apply: {'Stop on the card in Background automation: nothing is posted': entry, 'a plain step': entry}}});
  const found = lanesProblems(text, text, ['Stop on the card']);   // identical to its base: the entry is old, and still refused
  assert.equal(found.length, 1);
  assert.match(found[0], /Stop on the card in Background automation.*safety step.*never suspended/s);
  assert.deepEqual(lanesProblems(text, text, []), []);
});

test('the registry lists no safety step, and the marked steps are the ones the owner named (Full automation confirmation, nothing posted or pressed, Stop)', () => {
  const e2e = path.join(import.meta.dirname, '..');
  const safety = safetyStepNames(e2e);
  const lanes = JSON.parse(fs.readFileSync(path.join(e2e, 'lanes.json'), 'utf8'));
  const listedSteps = Object.entries(lanes.steps || {}).flatMap(([suite, byName]) => Object.keys(byName).map(name => `${suite} · ${name}`));
  assert.deepEqual(listedSteps.filter(item => isSafetyStep(item.split(' · ').slice(1).join(' · '), safety)), []);
  assert.ok(safety.length >= 15, `only ${safety.length} safety steps are marked`);
  for (const name of ['Stop on the card in Background automation', 'Stop on the card in Full automation', '"See which jobs can apply automatically"', 'Full automation asks once in Settings']) {
    assert.ok(safety.some(prefix => name.startsWith(prefix) || prefix.startsWith(name)), `${name} is not marked safety`);
  }
});

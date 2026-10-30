// Guards Rule B's declared timing debt without rewriting existing suite steps.
// Job: wait on state
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {timingCounts, timingViolations} from '../lib/timing-ratchet.mjs';

const wait = 'await page.waitForTimeout(100);';
const baseline = {sample: {fixedWaits: 1, elapsedAssertions: 0}};

test('a fixture at its fixed-wait baseline passes', () => {
  assert.deepEqual(timingViolations({sample: wait}, baseline), []);
});

test('one added fixed wait fails the declared baseline', () => {
  assert.match(timingViolations({sample: wait + wait}, baseline).join('\n'), /sample: fixedWaits 2 > baseline 1/);
});

test('removing a wait requires lowering the baseline', () => {
  assert.match(timingViolations({sample: ''}, baseline).join('\n'), /sample: fixedWaits 0 < baseline 1.*lower the baseline/);
});

test('a new suite starts at zero debt', () => {
  assert.match(timingViolations({newSuite: wait}, {}).join('\n'), /baseline 0 for a new suite/);
  assert.deepEqual(timingViolations({newSuite: ''}, {}), []);
});

test('counts each fixed-wait syntax, arbitrary Promise resolver names, and whitespace', () => {
  assert.deepEqual(timingCounts(`
    await page.waitForTimeout (10);
    await sleep (20);
    await new Promise(r => setTimeout(r, 30));
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    new Promise(done => { setTimeout(done, 40); });
  `), {fixedWaits: 5, elapsedAssertions: 0});
});

test('comments and prose do not become timing debt; state waits remain allowed', () => {
  assert.deepEqual(timingCounts(`
    // await page.waitForTimeout(100);
    /* await sleep(100); */
    const prose = 'new Promise(r => setTimeout(r, 100))';
    const label = \`await sleep(100)\`;
    await page.waitForFunction(() => window.rowExists);
    await pollUntil(() => rowExists(), {timeout: 30000});
    await new Promise(done => server.listen(0, done));
  `), {fixedWaits: 0, elapsedAssertions: 0});
});

test('elapsed-time assertions ratchet in both directions, independent of fixed waits', () => {
  const source = 'expect(elapsed).toBeLessThan(100); if (took > 200) throw new Error();';
  assert.deepEqual(timingCounts(source), {fixedWaits: 0, elapsedAssertions: 2});
  const debt = {sample: {fixedWaits: 0, elapsedAssertions: 2}};
  assert.deepEqual(timingViolations({sample: source}, debt), []);
  assert.match(timingViolations({sample: source + 'if (seconds > 20) problems.push();'}, debt).join('\n'), /elapsedAssertions 3 > baseline 2/);
  assert.match(timingViolations({sample: ''}, debt).join('\n'), /elapsedAssertions 0 < baseline 2.*lower the baseline/);
});

test('braced failures and node assertions also guard elapsed time', () => {
  assert.deepEqual(timingCounts(`
    if (elapsedMs > 100) { throw new Error(); }
    assert.ok(took < 200);
    assert(durationMs <= 300);
  `), {fixedWaits: 0, elapsedAssertions: 3});
});

test('only a declared clock lane exempts elapsed assertions, never fixed waits', () => {
  const lanes = {clockSuite: {lane: 'tolerant', input: 'clock'}, outside: {lane: 'tolerant', input: 'outside'}};
  const source = 'expect(elapsed).toBeLessThan(100);';
  assert.deepEqual(timingViolations({clockSuite: source}, {}, lanes), []);
  assert.match(timingViolations({outside: source}, {}, lanes).join('\n'), /elapsedAssertions/);
  assert.match(timingViolations({clockSuite: wait}, {}, lanes).join('\n'), /fixedWaits/);
});

test('removed suites must leave no stale baseline entries', () => {
  assert.match(timingViolations({}, baseline).join('\n'), /sample: remove the baseline for the deleted suite/);
});

test('every real suite matches the declared ratchet', () => {
  const suites = Object.fromEntries(readdirSync(new URL('../suites/', import.meta.url)).filter(file => file.endsWith('.mjs'))
    .map(file => [file.slice(0, -4), readFileSync(new URL(`../suites/${file}`, import.meta.url), 'utf8')]));
  const debt = JSON.parse(readFileSync(new URL('../timing-baseline.json', import.meta.url), 'utf8'));
  const lanes = JSON.parse(readFileSync(new URL('../lanes.json', import.meta.url), 'utf8')).suites;
  assert.deepEqual(timingViolations(suites, debt, lanes), []);
});

test('settings registers measured runner caps and no aggregate budget', async () => {
  const settings = await import('../suites/settings.mjs');
  const {budgetMsOf} = await import('../lib/runner.mjs');
  const {stepCalls} = await import('../lib/pr-suites.mjs');
  const {hangCapsFor} = await import('../lib/hang-caps.mjs');
  const sharedCaps = hangCapsFor('applyflows');
  assert.equal(settings.aggregateBudget, false);
  assert.equal(budgetMsOf(settings), Infinity);
  const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const direct = stepCalls(source('suites/settings.mjs')).map(step => step.name);
  const seed = stepCalls(source('lib/seed.mjs')).map(step => step.name);
  const required = [...direct, ...seed, 'nothing was queued to report to the product', 'the Notion stand-in answered every request the app made'];
  assert.ok(direct.length >= 9, 'positive control: settings literal steps were read');
  assert.deepEqual(Object.keys(settings.hangCaps).sort(), [...new Set(required)].sort());
  for (const [name, seconds] of Object.entries(settings.hangCaps)) {
    assert.ok(Number.isFinite(seconds) && seconds >= 30, `${name}: ${seconds}`);
  }
  const caps = JSON.parse(source('hang-caps.json')).settings;
  for (const [name, {seconds, p95Seconds, shared}] of Object.entries(caps.steps)) {
    if (shared || p95Seconds === undefined) continue;
    assert.equal(seconds, Math.max(30, Math.ceil(3 * p95Seconds / 5) * 5), name);
  }
  for (const name of ['the app is seeded as a set-up install from the existing workspace', 'the Notion stand-in answered every request the app made']) {
    assert.equal(settings.hangCaps[name], sharedCaps[name], 'sparse shared steps reuse the measured shared cap');
  }
});

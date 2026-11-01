// Guards complete measured caps for interactions, jobs and channel failures without starting an app.
// Job: wait on state
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {budgetMsOf, createRunner, stopMsOf} from '../../lib/runner.mjs';
import {stepCalls} from '../../lib/pr-suites.mjs';
import {hangCapsFor} from '../../lib/hang-caps.mjs';
import {VIEWS} from '../../lib/uicheck.mjs';
import * as interactions from '../../suites/interactions.mjs';
import * as jobs from '../../suites/jobs.mjs';

const source = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const names = text => stepCalls(text).flatMap(call => call.name ?? VIEWS.map(view =>
  view + text.slice(call.start, call.end).match(/`\$\{view\}([^`]+)`/)[1]));
const finalSteps = ['no AI call of this suite reached a real model: the stand-in answered or refused every one', 'nothing was queued to report to the product', 'the Notion stand-in answered every request the app made'];

// Why (1 Nov 2026, owner "Shrink in cleanup", a8): the step count was typed in here and had to follow every step a layer moved out (#2763, #2770, a509995 all went red on it); the property is that every step
// the suite source declares has a cap, so the count is read, and the suite's own scan (not the list padded with the 3 final steps) must find at least one step.
for (const [suiteName, suite, largest, minutes] of [
  ['interactions', interactions, 220, 25], ['jobs', jobs, 395, 30],
]) {
  test(`${suiteName}: every step has a measured or documented fallback cap and no aggregate clock`, () => {
    const caps = JSON.parse(source('hang-caps.json'))[suiteName];
    const direct = source(`suites/${suiteName}.mjs`);
    const required = [...names(direct), ...names(source('lib/seed.mjs')), ...finalSteps];
    assert.ok(names(direct).length > 0, 'positive control: the suite\'s own steps were read from its source, an empty scan never passes');
    assert.deepEqual(Object.keys(suite.hangCaps).sort(), [...new Set(required)].sort());
    assert.equal(suite.aggregateBudget, false);
    assert.equal(budgetMsOf(suite), Infinity);
    assert.equal(stopMsOf(suite), null);
    assert.equal(suite.minutes, minutes, 'the CI job limit stays unchanged');
    assert.equal(Math.max(...Object.values(suite.hangCaps)), largest);
    assert.doesNotMatch(source(`suites/${suiteName}.mjs`), /limitMs\s*:/, 'explicit overrides must not bypass measured caps');
    assert.match(caps.provenance, /Main run IDs: (?:\d+, ){8}\d+\./, 'record all nine source runs');
    for (const [name, seconds] of Object.entries(suite.hangCaps)) {
      assert.ok(Number.isFinite(seconds) && seconds >= 30, `${name}: ${seconds}`);
    }
    const rows = Object.entries(caps.steps).filter(([, step]) => !step.shared && step.p95Seconds !== undefined);
    const shared = Object.entries(caps.steps).filter(([, step]) => step.shared);
    assert.equal(rows.length + shared.length, Object.keys(caps.steps).length, 'every cap has provenance');
    for (const [name, {seconds, n, p95Seconds}] of rows) {
      assert.ok(n >= 5, `${name}: insufficient calm samples`);
      assert.equal(seconds, Math.max(30, Math.ceil(3 * p95Seconds / 5) * 5), name);
    }
    for (const [name, {n, shared: sharedSuite}] of shared) {
      assert.ok(n < 5);
      assert.equal(suite.hangCaps[name], hangCapsFor(sharedSuite)[name]);
    }
  });

  test(`${suiteName}: the runner cuts every hung step at its named cap and continues`, async t => {
    assert.ok(suite.hangCaps, 'the suite must supply caps to the runner');
    t.mock.method(console, 'log', () => {});
    t.mock.timers.enable({apis: ['setTimeout']});
    const runner = createRunner(() => null, {keepGoing: true, budgetMs: budgetMsOf(suite), hangCaps: suite.hangCaps});
    for (const [name, seconds] of Object.entries(suite.hangCaps)) {
      const before = runner.results.length;
      let entered;
      const started = new Promise(resolve => { entered = resolve; });
      const pending = runner.run(name, () => { entered(); return new Promise(() => {}); });
      await started;
      t.mock.timers.tick(seconds * 1000 - 1);
      await new Promise(setImmediate);
      assert.equal(runner.results.length, before, `${name}: not cut before its cap`);
      t.mock.timers.tick(1);
      await pending;
      assert.equal(runner.results.at(-1).status, 'failed');
      assert.match(runner.results.at(-1).note, new RegExp(`within ${seconds} s \\(it hung\\)`));
    }
    await runner.run('after the hangs', async () => {});
    assert.equal(runner.results.at(-1).status, 'passed');
  });
}

// Why (31 Oct 2026, owner, a8 2/5; floor 20 -> 10 on 1 Nov 2026, owner: the beta keeps only critical journeys, 19 suites left after the layered move): a backbone suite names a cap for every step it runs, and every cap is below its job's budget. Setup caps are worst-case hang stops,
// not what setup takes, so they are not added to a step's cap; the runner hands the step min(cap, budget left) and its own waits end first.
test('every backbone suite has a cap table and every cap is a positive number below its job budget', async () => {
  const {readdirSync} = await import('node:fs');
  const {cadenceOf} = await import('../../lib/plan.mjs');
  const lanes = JSON.parse(source('lanes.json')).suites;
  const data = JSON.parse(source('hang-caps.json'));
  const violations = [], checked = [];
  for (const file of readdirSync(new URL('../../suites/', import.meta.url)).filter(file => file.endsWith('.mjs'))) {
    const name = file.slice(0, -4), suite = await import(`../../suites/${file}`);
    if (lanes[name]?.lane || cadenceOf(name, suite) === 'manual') continue;   // tolerant, suspended, retired and manual suites keep the default (explore: cadence manual)
    checked.push(name);
    if (!data[name] || !Object.keys(data[name].steps).length) { violations.push(`${name}: no measured hang cap table`); continue; }
    const budgetMs = budgetMsOf(suite, {E2E_TRY_MINUTES: '15'});
    for (const [step, seconds] of Object.entries(hangCapsFor(name))) {
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 >= budgetMs) violations.push(`${name}/${step}: cap ${seconds} s, job budget ${budgetMs / 1000} s`);
    }
  }
  // Why (1 Nov 2026, owner's three layers): the floor only proves the class is not an empty list; a floor of 20 and then 10 failed each time a layer moved suites out of e2e (8 remain on 1 Nov 2026 after storemove and failuresnotion left), so it is 5, like the aiAnswers floor (a floor against an empty list, not a headcount).
  assert.ok(checked.length >= 5 && checked.includes('apply'), 'positive control: the class covers the backbone, not an empty list');
  assert.ok(!checked.includes('explore') && !checked.includes('personas'), 'explore is manual and personas is tolerant');
  assert.deepEqual(violations, [], violations.join('\n'));
});

// Why (31 Oct 2026, owner, a8 2/5): the first tables came from history, which missed steps only a variant reaches (wizard's OpenAI and Codex steps run on CI's odd runs
// only). Reading the step names from the code finds them. A literal name is read from the suite's file and the helpers it imports directly; a name another slice of the
// suite owns (apply's journeys belong to applyflows) resolves in that suite's table. Templated names (`${...}`) are not literal: their suites measure them by prefix.
test('every literal step a backbone suite runs has a cap in some backbone table', async () => {
  const {readdirSync} = await import('node:fs');
  const {cadenceOf} = await import('../../lib/plan.mjs');
  const lanes = JSON.parse(source('lanes.json')).suites;
  const capped = Object.keys(JSON.parse(source('hang-caps.json'))).flatMap(suite => Object.keys(hangCapsFor(suite))).filter(Boolean);
  const literals = file => stepCalls(source(file).replace(/\brunAlways\(/g, 'ctx.run(')).map(call => call.name).filter(Boolean);
  const helperFiles = readdirSync(new URL('../../lib/', import.meta.url)).filter(file => file.endsWith('.mjs')).map(file => `lib/${file}`);
  const uncapped = [], checked = [];
  for (const file of readdirSync(new URL('../../suites/', import.meta.url)).filter(file => file.endsWith('.mjs'))) {
    const suite = file.slice(0, -4);
    if (lanes[suite]?.lane || cadenceOf(suite, await import(`../../suites/${file}`)) === 'manual') continue;
    const helpers = [...source(`suites/${file}`).matchAll(/from\s+'\.\.\/lib\/([^']+\.mjs)'/g)].map(match => `lib/${match[1]}`).filter(helper => helperFiles.includes(helper));
    checked.push(suite);
    for (const name of [`suites/${file}`, ...helpers].flatMap(literals)) if (!capped.some(head => name.startsWith(head))) uncapped.push(`${suite}: ${name}`);
  }
  // Why (1 Nov 2026, owner's three layers): the floor only proves the class is not an empty list; a floor of 20 and then 10 failed each time a layer moved suites out of e2e (8 remain on 1 Nov 2026 after storemove and failuresnotion left), so it is 5, like the aiAnswers floor (a floor against an empty list, not a headcount).
  assert.ok(checked.length >= 5 && checked.includes('wizard'), 'positive control: the class reads the real backbone suites');
  assert.deepEqual(uncapped, [], `these steps would fail with "no hang cap":\n${uncapped.join('\n')}`);
});

// Guards complete measured caps for interactions, jobs and channel failures without starting an app.
// Job: wait on state
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {budgetMsOf, createRunner, stopMsOf} from '../lib/runner.mjs';
import {stepCalls} from '../lib/pr-suites.mjs';
import {hangCapsFor} from '../lib/hang-caps.mjs';
import {VIEWS} from '../lib/uicheck.mjs';
import * as interactions from '../suites/interactions.mjs';
import * as jobs from '../suites/jobs.mjs';
import * as failureschannels from '../suites/failureschannels.mjs';

const sharedCaps = hangCapsFor('applyflows');
const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const names = text => stepCalls(text).flatMap(call => call.name ?? VIEWS.map(view =>
  view + text.slice(call.start, call.end).match(/`\$\{view\}([^`]+)`/)[1]));
const finalSteps = ['nothing was queued to report to the product', 'the Notion stand-in answered every request the app made'];
const linkStep = "the app's next start links this workspace's Search settings page (so the check looks for this person's roles and places)";

for (const [suiteName, suite, count, largest, minutes] of [
  ['interactions', interactions, 25, 220, 25], ['jobs', jobs, 13, 495, 30], ['failureschannels', failureschannels, 11, 180, 12],
]) {
  test(`${suiteName}: every step has a measured or documented fallback cap and no aggregate clock`, () => {
    const caps = JSON.parse(source('hang-caps.json'))[suiteName];
    let direct = source(`suites/${suiteName}.mjs`);
    let preparation = '';
    if (suiteName === 'failureschannels') {
      const activity = source('suites/activityfailures.mjs');
      const start = activity.indexOf("  if (parts.includes('channels')) {");
      assert.ok(start > 0, 'positive control: the delegated channels block exists');
      direct = activity.slice(start, activity.indexOf("  if (parts.includes('ai')) {", start));
      preparation = source('lib/activity-steps.mjs');
    }
    const required = [...names(direct), ...names(preparation), ...names(source('lib/seed.mjs')), ...finalSteps];
    assert.equal(required.length, count, 'positive control: all direct, generated, shared and final steps were read');
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
    assert.equal(rows.length + shared.length + (suiteName === 'jobs' ? 1 : 0), count, 'every cap has provenance');
    for (const [name, {seconds, n, p95Seconds}] of rows) {
      assert.ok(n >= 5, `${name}: insufficient calm samples`);
      assert.equal(seconds, Math.max(30, Math.ceil(3 * p95Seconds / 5) * 5), name);
    }
    for (const [name, {n, shared: sharedSuite}] of shared) {
      assert.ok(n < 5);
      assert.equal(sharedSuite, 'applyflows');
      assert.equal(suite.hangCaps[name], sharedCaps[name]);
    }
    if (suiteName === 'jobs') {
      assert.equal(suite.hangCaps[linkStep], 90);
      assert.deepEqual(caps.steps[linkStep], {seconds: 90, n: 4, reason: 'fewer than 5 calm samples, no shared cap; 30 s floor x 3'});
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

// The e2e audit's keep / slim / drop (owner's yes, 26 Oct 2026) on the REAL suites: every suite is in exactly one list (a new suite fails here until it is placed),
// slim suites run at night and in every release gate but not in a soak top-up or the stable canary, and a dropped suite runs only by name.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planRun, suiteFacts} from '../plan-run.mjs';
import {SLIM, autoSuites} from '../lib/plan.mjs';

const KEEP = ['activity', 'activityfailures', 'apply', 'applyflows', 'cardstates', 'employers', 'failureschannels', 'interactions', 'mailreading', 'quality', 'settings'];
const DROPPED = ['foryou', 'notion-real', 'personas', 'pool'];
const BY_HAND = ['explore'];   // never scheduled by design: it spends the owner's AI credit

const SHA = 'a'.repeat(40);
const gh = args => (args[0] === 'api' && /commits\//.test(args.join(' ')) ? SHA : '[]');
const plan = async env => new Set((await planRun({env: {REPO: 'o/r', SHA, ...env}, gh, ...(await suiteFacts())})).suites.split(',').filter(Boolean));

test('every suite is kept, slimmed, dropped or by hand, exactly once', async () => {
  const {all} = await suiteFacts();
  const lists = [...KEEP, ...SLIM, ...DROPPED, ...BY_HAND];
  assert.deepEqual(all.filter(suite => !lists.includes(suite)), [], 'a new suite: put it in KEEP here, or in SLIM (lib/plan.mjs)');
  assert.deepEqual(lists.filter(suite => !all.includes(suite)), [], 'a listed suite no longer exists');
  assert.equal(new Set(lists).size, lists.length, 'a suite is in two lists');
});

test('a slim suite gets its cadence from the table only; a dropped one exports manual itself', async () => {
  for (const suite of SLIM) assert.equal((await import(`../suites/${suite}.mjs`)).cadence, undefined, `${suite} exports a cadence of its own: SLIM (lib/plan.mjs) decides`);
  const {cadence} = await suiteFacts();
  for (const suite of SLIM) assert.equal(cadence[suite], 'slim', suite);
  for (const suite of [...DROPPED, ...BY_HAND]) assert.equal(cadence[suite], 'manual', suite);
  for (const suite of KEEP) assert.ok(!['manual', 'slim'].includes(cadence[suite]), `${suite} is kept: no manual or slim cadence`);
});

test('slim suites run at night and in both release gates; never in a soak top-up or the stable canary', async () => {
  const night = await plan({EVENT: 'schedule'});
  for (const kind of ['nightly', 'beta']) {
    const gate = await plan({EVENT: 'gate', TARGET_REF: 'desktop-v9.9', GATE_TAG: 'desktop-v9.9', GATE_KIND: kind});
    assert.deepEqual(SLIM.filter(suite => !gate.has(suite)), [], `the ${kind} gate left out a slim suite`);
  }
  assert.deepEqual(SLIM.filter(suite => !night.has(suite)), [], 'the night schedule left out a slim suite (the code → suite map is built from it)');
  const repeat = await plan({EVENT: 'workflow_dispatch', TARGET_REF: 'desktop-v9.9'});   // canary-promote.yml's soak top-up and stable-canary.yml: a release's commit, no gate
  assert.deepEqual(SLIM.filter(suite => repeat.has(suite)), [], 'a soak top-up or the canary ran a slim suite');
  assert.deepEqual(KEEP.filter(suite => !repeat.has(suite) && !['mailreading', 'quality'].includes(suite)), [], 'a kept suite left the soak top-up');
  const named = await plan({EVENT: 'workflow_dispatch', TARGET_REF: 'desktop-v9.9', ONLY: 'jobs'});
  assert.ok(named.has('jobs'), 'a slim suite named by hand still runs on a release');
});

test('a dropped suite runs only by name', async () => {
  for (const env of [{EVENT: 'schedule'}, {EVENT: 'gate', TARGET_REF: 'desktop-v9.9', GATE_TAG: 'desktop-v9.9', GATE_KIND: 'nightly'}, {EVENT: 'workflow_dispatch'}]) {
    const planned = await plan(env);
    assert.deepEqual(DROPPED.filter(suite => planned.has(suite)), [], `${env.EVENT} planned a dropped suite`);
  }
  assert.ok((await plan({EVENT: 'workflow_dispatch', ONLY: 'foryou'})).has('foryou'));
});

test('autoSuites: slim is an always suite except in a repeat', () => {
  const all = ['a', 'b', 'c', 'd'], cadence = {b: 'slim', c: 'nightly', d: 'manual'};
  assert.deepEqual(autoSuites(all, cadence), ['a', 'b', 'c']);
  assert.deepEqual(autoSuites(all, cadence, true), ['a', 'b']);
  assert.deepEqual(autoSuites(all, cadence, false, true), ['a', 'c']);
});

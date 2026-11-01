// The desktop unit tests are planned as one more leg of each lane's Test matrix in a release run (GATE_UNIT=1, desktop.yml) and nowhere else (owner, 1 Nov 2026: "let's go this way").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planRun} from '../../plan-run.mjs';
import {UNIT_SUITE, unitLeg, withUnitLeg} from '../../lib/unit-leg.mjs';

const ALL = ['apply', 'jobs', 'settings'];
const stub = args => (args[0] === 'api' && /commits\/desktop-v1\.5$/.test(args[1]) ? 'cafe'.repeat(10) + '\n' : '[]');
const gate = extra => planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'mainsha', TARGET_REF: 'desktop-v1.5', GATE_TAG: 'desktop-v1.5', ...extra}, gh: stub, all: ALL, minutes: () => 15,
  sameOnEveryOs: [], shards: {}});

test('a release run plans the unit leg first in each lane, named whole, and counts it', async () => {
  const without = await gate({});
  const withUnit = await gate({GATE_UNIT: '1'});
  const mac = JSON.parse(withUnit.matrix).include, windows = JSON.parse(withUnit.windows_matrix).include;
  assert.deepEqual(mac[0], {suite: UNIT_SUITE, key: 'unit', name: 'Unit tests · Mac', os: 'macos-latest'});
  assert.deepEqual(windows[0], {suite: UNIT_SUITE, key: 'unit', name: 'Unit tests · Windows'});
  assert.deepEqual(mac.slice(1), JSON.parse(without.matrix).include, 'the e2e legs are exactly what they were');
  assert.deepEqual(windows.slice(1), JSON.parse(without.windows_matrix).include);
  assert.equal(Number(withUnit.count), Number(without.count) + 1, 'the unit leg counts as a job to run, so a plan with no suite still runs it');
  for (const key of ['suites', 'windows_suites', 'review', 'ai_required', 'tag', 'ref']) assert.equal(withUnit[key], without[key], `${key} stays the E2E plan's`);
  assert.ok(![...mac, ...windows].filter(leg => leg.suite !== UNIT_SUITE).some(leg => leg.name), 'only the unit leg carries a whole job name; the suites keep "E2E · …" names');
});

test('no other run plans a unit leg: only GATE_UNIT=1 adds it', async () => {
  for (const extra of [{}, {GATE_UNIT: ''}, {GATE_UNIT: '0'}]) {
    const out = await gate(extra);
    assert.ok(!JSON.parse(out.matrix).include.some(leg => leg.suite === UNIT_SUITE), JSON.stringify(extra));
    assert.ok(!JSON.parse(out.windows_matrix).include.some(leg => leg.suite === UNIT_SUITE), JSON.stringify(extra));
  }
  assert.deepEqual(withUnitLeg({include: [1]}, 'Mac', {}), {include: [1]});
  assert.equal(unitLeg('Windows').os, undefined, 'the Windows job has its own runner');
});

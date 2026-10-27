// Pool runs measure filling, so the eligibility stop is off in them on BOTH paths (lib/pool-eligibility.mjs): smoke gives every row LIVE_ELIGIBILITY=off,
// and every live runner that presses the app's Apply sets the extension's switch first. A new runner or a new smoke spawn without it fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {POOL_LINE, applyPoolEligibility, eligibilityOff, poolEnv} from '../lib/pool-eligibility.mjs';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A service worker stand-in: evaluate() runs the function against a chrome.storage.local kept in a plain object (`keeps: false` drops every write). It passes evaluate's argument on, as Playwright does (setExtensionStorage hands its values over that way since 18 Oct 2026).
const fakeWorker = ({keeps = true} = {}) => {
  const stored = {};
  const chrome = {storage: {local: {set: async values => { if (keeps) Object.assign(stored, values); }, get: async key => (key in stored ? {[key]: stored[key]} : {})}}};
  return {stored, evaluate: async (fn, arg) => { globalThis.chrome = chrome; try { return await fn(arg); } finally { delete globalThis.chrome; } }};
};

test('a pool row runs with the eligibility check off unless RECORD_ELIGIBILITY=on keeps it', () => {
  assert.equal(eligibilityOff(poolEnv({})), true);
  assert.equal(eligibilityOff(poolEnv({RECORD_ELIGIBILITY: 'on'})), false);
  assert.equal(eligibilityOff({}), false, 'a run outside the pool keeps the check');
});

test('the switch is set in the extension, read back, and said in the run', async () => {
  const worker = fakeWorker(), said = [];
  assert.equal(await applyPoolEligibility(worker, {env: poolEnv({}), say: line => said.push(line)}), true);
  assert.equal(worker.stored.checkEligibility, false);
  assert.deepEqual(said, [POOL_LINE]);
  const kept = fakeWorker();
  assert.equal(await applyPoolEligibility(kept, {env: {}}), false);
  assert.equal('checkEligibility' in kept.stored, false, 'outside the pool the extension is left as it is');
});

test('a switch that did not take fails the run before anything is pressed', async () => {
  await assert.rejects(applyPoolEligibility(fakeWorker({keeps: false}), {env: poolEnv({})}), /asked OFF/);
});

test('every smoke spawn of a live row carries the pool env (both paths)', () => {
  const source = fs.readFileSync(path.join(E2E, 'record-sites.mjs'), 'utf8');
  const spawns = [...source.matchAll(/spawn\('node', \[[\s\S]*?env: \{([^}]*)/g)].map(match => match[1]);
  assert.ok(spawns.length >= 2, `smoke spawns both paths (found ${spawns.length})`);
  for (const env of spawns) assert.match(env, /^\.\.\.poolEnv\(\)/, `a smoke spawn without the pool env: {${env.slice(0, 80)}`);
});

test('every live runner sets the switch before it presses Apply', () => {
  const dir = path.join(E2E, 'lib');
  const runners = fs.readdirSync(dir).filter(name => name.endsWith('.mjs')).map(name => [name, fs.readFileSync(path.join(dir, name), 'utf8')])
    .filter(([, source]) => /window\.pilot\.applyOne\(|call\('applyOne'/.test(source));
  // apply-journeys.mjs presses Apply on the fixture forms only (each job seeded with a drafted kit), never a pool row: deliberately left out.
  const fixtureOnly = new Set(['apply-journeys.mjs']);
  assert.deepEqual(runners.map(([name]) => name).sort(), ['apply-journeys.mjs', 'apply-live.mjs', 'live-row.mjs'], 'a new runner presses Apply: give it the switch, or name it fixture-only here');
  for (const [name, source] of runners.filter(([name]) => !fixtureOnly.has(name))) {
    const set = source.indexOf('applyPoolEligibility('), press = source.search(/window\.pilot\.applyOne\(|call\('applyOne'/);
    assert.ok(set > 0 && set < press, `${name} presses Apply without setting the pool's eligibility switch first`);
  }
});

test('a replay runs with the eligibility stop as its live run had it: the record says so, else the live log does', async () => {
  const {POOL_LINE, recordedEligibility} = await import('../lib/pool-eligibility.mjs');
  assert.equal(recordedEligibility({eligibility: 'on'}, POOL_LINE), 'on', 'the record\'s own word wins');
  assert.equal(recordedEligibility({eligibility: 'off'}, ''), 'off');
  assert.equal(recordedEligibility({}, `live: ${POOL_LINE}`), 'off');
  assert.equal(recordedEligibility({}, '[extension] fill: filled the form {"aiEligible":false,"forced":"check off"}'), 'off', 'a record made before the field: Teamtailor, 14 Oct 2026');
  assert.equal(recordedEligibility({}, '[extension] fill: filled the form {"forced":""}'), 'on');
  const replay = fs.readFileSync(new URL('../replay-net.mjs', import.meta.url), 'utf8'), row = fs.readFileSync(new URL('../lib/live-row.mjs', import.meta.url), 'utf8');
  assert.ok(replay.indexOf('recordedEligibility(record, liveLog)') < replay.indexOf('await runLiveRow('), 'the replay sets the stop before the row runs');
  assert.match(row, /eligibility: eligibilityOff\(process\.env\) \? 'off' : 'on'/, 'each new record keeps it');
});

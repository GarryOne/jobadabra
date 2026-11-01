// The CI refill's rules (lib/refill.mjs, refill-pick.mjs, lib/ai-proxy.mjs maxCalls, lib/fill-memo.mjs oldKeysKept): the matrix pick, the cap, the no-fallback key, the fork guard, old answers kept.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {capRefusal, creditsLine, fingerprintChanged, forkRefusal, groupsOf, keyRefusal, MAIN_MAX_ASKS, MAX_ASKS, needsRefill, outOfCredits, PER_ASK_USD, pickMain, pickRefill, refillKey, SECRET} from '../../lib/refill.mjs';
import {oldKeysKept} from '../../lib/fill-memo.mjs';
import {fillOn} from '../../../lib/ai/model-memo.js';
import {startAiProxy} from '../../lib/ai-proxy.mjs';

const askChanged = (extra = 2) => ({name: 'a', network: {extra}, firstMiss: {differs: ['user:1']}});
const promptChanged = {name: 'b', network: {extra: 1}, firstMiss: {differs: ['system:0']}};

test('the pick takes only the pinned rows whose gate verdict is ask changed or out of date', () => {
  const records = [askChanged(), promptChanged, {name: 'c', network: {extra: 0}, firstMiss: null}, {...askChanged(), name: 'unpinned'}, {...askChanged(), name: 'd', deferred: 'x'}];
  const picked = pickRefill({pins: ['a', 'b', 'c', 'd'], records});
  assert.deepEqual(picked.rows.map(row => row.name), ['a', 'b']);
  assert.equal(picked.asks, 3);
  assert.equal(picked.usd, 0.003);
  assert.equal(needsRefill(records[2]), false);
});

test('all takes every pinned row, at least one ask each, and no row that is not pinned', () => {
  const picked = pickRefill({pins: ['a', 'z'], records: [askChanged(4)], all: true});
  assert.deepEqual(picked.rows, [{name: 'a', asks: 4}, {name: 'z', asks: 1}]);
});

test('the cap refuses a run above the asks or the dollars, and says the estimate', () => {
  assert.equal(capRefusal({asks: 10, usd: 0.6}), '');
  assert.match(capRefusal({asks: MAX_ASKS + 1, usd: 1}), /above the cap of 40/);
  assert.match(capRefusal({asks: 10, usd: 9}), /above the \$3 cap/);
  assert.match(capRefusal({asks: 10, usd: 0.6}, {maxAsks: 5}), /cap of 5/);
});

test('the key has no fallback: another key in the environment is never used', () => {
  const others = {ANTHROPIC_API_KEY: 'a', E2E_ANTHROPIC_KEY: 'b', LIVE_POOL_ANTHROPIC_KEY: 'c'};
  assert.equal(refillKey(others), '');
  assert.match(keyRefusal(others), /no REPLAY_REFILL_ANTHROPIC_KEY/);
  assert.equal(refillKey({...others, [SECRET]: 'k'}), 'k');
  assert.equal(keyRefusal({[SECRET]: 'k'}), '');
});

test('a fork PR, or an unknown one, never gets the key', () => {
  assert.equal(forkRefusal({number: 5, isCrossRepository: false}), '');
  assert.match(forkRefusal({number: 5, isCrossRepository: true}), /fork/);
  assert.match(forkRefusal(null), /fork or unknown/);
  assert.match(forkRefusal({number: 5}), /fork or unknown/);
});

test('an empty balance or a spent limit is named as out of credits', () => {
  assert.equal(outOfCredits({'400 invalid_request_error: Your credit balance is too low to access the Anthropic API.': 2}), true);
  assert.equal(outOfCredits({'429 rate_limit_error: slow down': 1}), false);
  assert.match(creditsLine, /OUT OF CREDITS/);
});

test('a fill asks the model on CI only with the refill flag, never otherwise', () => {
  const base = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_ONLY: '1', JOB_PILOTTO_MODEL_MEMO_FILL: '1'};
  assert.equal(fillOn(base), true, 'a Mac');
  assert.equal(fillOn({...base, CI: 'true'}), false, 'CI without the flag');
  assert.equal(fillOn({...base, GITHUB_ACTIONS: 'true'}), false);
  assert.equal(fillOn({...base, CI: 'true', JP_REFILL_CI: '1'}), true, 'CI through the refill workflow');
});

test('old answer keys are never lost or changed; a new key is fine', () => {
  assert.deepEqual(oldKeysKept({a: 1, 'a#ms': 5}, {a: 1, 'a#ms': 5, b: 2}), []);
  assert.deepEqual(oldKeysKept({a: 1, c: 3}, {a: 2}), ['a', 'c']);
});

test('the proxy refuses the paid call past its cap before it reaches the API', async () => {
  const proxy = await startAiProxy({target: 'http://127.0.0.1:1', maxCalls: 1});
  try {
    const ask = () => fetch(`${proxy.url}/v1/messages`, {method: 'POST', body: '{}', headers: {'content-type': 'application/json'}});
    assert.equal((await ask()).status, 502, 'the first call goes out (to a closed port here)');
    const second = await ask();
    assert.equal(second.status, 400);
    assert.match(await second.text(), /cap of 1 paid calls/);
  } finally { await proxy.close(); }
});

// Measured on the API (15 Oct 2026, the by-hand refill of PR 824): $0.0012 in 3 calls and $0.0016 in 4 calls, about $0.0004 a call. The plan path's $0.06 an ask was 100x too high: with it an all-rows run on main
// would have been refused by its own cap.
test('the estimate uses the API\'s measured price, with a margin', () => {
  assert.ok(PER_ASK_USD >= 0.0004 * 2 && PER_ASK_USD <= 0.005, `${PER_ASK_USD}: measured $0.0004 a call, a margin of a few times`);
});

// The automatic refill on main (owner, 15 Oct 2026): after a merge that changes a ladder prompt, every recorded row gets its missing answers, pinned or not, through the guard.
test('a merge to main triggers the refill only when a prompt fingerprint changed (a score update alone does not)', () => {
  const before = {promptFingerprint: {rung2: 'a', rung3: 'b'}, fixtures: {x: 1}};
  assert.equal(fingerprintChanged(before, {promptFingerprint: {rung3: 'b', rung2: 'a'}, fixtures: {x: 2}}), false, 'same fingerprints in another order, other scores: no refill');
  assert.equal(fingerprintChanged(before, {promptFingerprint: {rung2: 'a2', rung3: 'b'}}), true, 'one rung\'s prompt changed');
  assert.equal(fingerprintChanged(before, {promptFingerprint: {rung2: 'a', rung3: 'b', rung4: 'c'}}), true, 'a new rung\'s prompt');
  assert.equal(fingerprintChanged(null, {promptFingerprint: {rung2: 'a'}}), true, 'no earlier file: refill');
  assert.equal(fingerprintChanged(before, null), false, 'no file after: nothing to refill');
});

test('on main every recorded row is picked, pinned or not, minus the deferred ones; the cap is the main run\'s own', () => {
  const picked = pickMain({names: ['b row', 'a row', 'deferred row', 'a row'], deferred: {'deferred row': 'replay lags'}});
  assert.deepEqual(picked.rows.map(row => row.name), ['a row', 'b row'], 'sorted, once each, no deferred row');
  assert.equal(picked.asks, 8);
  const known = pickMain({names: ['a row', 'https://old.example/job', 'unnamed host'], known: new Set(['a row'])});
  assert.deepEqual(known.rows.map(row => row.name), ['a row'], 'an old record named by its address is no pool row');
  assert.equal(capRefusal(picked, {maxAsks: MAIN_MAX_ASKS}), '');
  assert.ok(MAIN_MAX_ASKS > MAX_ASKS, 'a run over every recorded row asks more than a by-hand run for a few');
  assert.match(capRefusal({asks: MAIN_MAX_ASKS + 1, usd: 0.2}, {maxAsks: MAIN_MAX_ASKS}), /above the cap of 200/, 'a runaway still stops');
});

// records-publish.mjs refuses more than 3 rows at once (its guard replays each row twice): the publish step works in groups of 3, one runner each.
test('rows are published in groups of at most 3, each row in exactly one group', () => {
  const names = Array.from({length: 7}, (_, at) => `row ${at}`);
  const groups = groupsOf(names, 3);
  assert.deepEqual(groups.map(group => group.length), [3, 3, 1]);
  assert.deepEqual(groups.flat(), names);
  assert.deepEqual(groupsOf([], 3), []);
});

test('refill-group.mjs copies the k-th group of 3 row folders out of the staged set: the groups together are every row, none twice', async () => {
  const {execFileSync} = await import('node:child_process'), fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-group-')), staged = path.join(tmp, 'staged');
  for (let at = 0; at < 7; at += 1) { fs.mkdirSync(path.join(staged, `row-${at}`), {recursive: true}); fs.writeFileSync(path.join(staged, `row-${at}`, 'record.json'), '{}'); }
  const got = [0, 1, 2, 3].map(index => { const out = path.join(tmp, `g${index}`); execFileSync(process.execPath, [path.join(import.meta.dirname, '..', '..', 'refill-group.mjs'), staged, String(index), out], {stdio: 'pipe'}); return fs.existsSync(out) ? fs.readdirSync(out).sort() : []; });
  assert.deepEqual(got.map(group => group.length), [3, 3, 1, 0], 'groups of at most 3; a group past the end is empty');
  assert.deepEqual(got.flat(), Array.from({length: 7}, (_, at) => `row-${at}`));
  fs.rmSync(tmp, {recursive: true, force: true});
});

test('the pick says how many publish groups there are (both modes)', async () => {
  const {execFileSync} = await import('node:child_process'), path = await import('node:path');
  const pins = path.join(import.meta.dirname, '..', '..', 'replay-faithful.json');
  const out = JSON.parse(execFileSync(process.execPath, [path.join(import.meta.dirname, '..', '..', 'refill-pick.mjs'), pins, '-', '--all'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim().split('\n').at(-1));
  assert.deepEqual(out.groups, Array.from({length: Math.ceil(out.rows.length / 3)}, (_, at) => at), 'one matrix entry per group of 3');
});

test('a main refill with `only` takes just those rows (the daily replay starts it for the rows it flags)', () => {
  const names = ['a row', 'b row', 'c row'];
  assert.deepEqual(pickMain({names, only: ['c row', 'a row']}).rows.map(row => row.name), ['a row', 'c row']);
  assert.equal(pickMain({names, only: []}).rows.length, 3, 'empty = every recorded row');
});

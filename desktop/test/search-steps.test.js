// "Find jobs" is one run: the first run lists jobs in seconds (the slice first), a later one searches as before, and the employer finder closes it when due.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SCOUT_SHARE_S, scoutDue, searchSteps} from '../lib/search-steps.js';
import {SEARCH_BUDGET_S} from '../lib/pipeline-args.js';

const storage = (settings = {}) => ({settings: () => ({aiEngine: 'cli', ...settings}), saveSettings: patch => Object.assign(settings, patch), secret: () => ''});
const commands = async (settings, trigger) => {
  const seen = [];
  await searchSteps(storage(settings), () => {}, 'run', trigger, async (_storage, args) => { seen.push(args.slice(0, 2).join(' ') + (args.includes('--first-jobs') ? ' --first-jobs' : '') + (args.includes('today') ? ' today' : '')); return {code: 0, result: {}}; });
  return seen;
};

test('the first run reads the slice and scores 3 jobs before the job boards, then grows the sources', async () => {
  const seen = await commands({lastScoutAt: undefined}, 'first');
  assert.equal(seen[0], 'src daily --first-jobs', 'the engine goes first: nothing stands in front of the first job');
  assert.ok(seen.findIndex(c => c.startsWith('src discover')) > 0);
  assert.equal(seen.at(-1), 'src scout');
});

test('a later press searches the job boards first, and runs the finder only when none ran today', async () => {
  const now = Date.now();
  const stale = await commands({lastScoutAt: new Date(now - 2 * 86400000).toISOString()}, 'you');
  assert.deepEqual(stale.slice(0, 2), ['src discover', 'src daily']);
  assert.equal(stale.at(-1), 'src scout');
  const fresh = await commands({lastScoutAt: new Date(now - 3600000).toISOString()}, 'you');
  assert.ok(!fresh.includes('src scout'));
});

test('a scheduled search and a search on GitHub leave the finder to their own schedule', () => {
  assert.equal(scoutDue({}, 'schedule'), false);
  assert.equal(scoutDue({cloud: {repo: 'x/y'}}, 'you'), false);
  assert.equal(scoutDue({}, 'first'), true);
});

// One deadline for the whole press (owner, 26 Oct 2026: "A find jobs session should take at most 3min"): the 06:21 press took 269 s, discover
// 177 s with no clock before daily's own 3 minutes. Each step here takes the seconds `spend` gives it on a fake clock.
const press = async (settings, trigger, spend = {}) => {
  let clock = Date.parse('2026-10-26T06:21:11Z');
  const calls = [], lines = [];
  await searchSteps(storage(settings), line => lines.push(line), 'run', trigger, async (_storage, args, _onLine, env) => {
    const step = args[1] + (args.includes('--first-jobs') ? ' --first-jobs' : '');
    calls.push({step, args, env});
    clock += (spend[step] ?? spend[args[1]] ?? 0) * 1000;
    return {code: 0, result: {}};
  }, {now: () => clock});
  return {calls, lines: lines.join('\n'), settings};
};
const flag = (args, name) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : undefined);
const stale = () => new Date(Date.now() - 2 * 86400000).toISOString();

test('every step of one press counts from the press: one 3-minute deadline', async () => {
  for (const trigger of ['first', 'you']) {
    const {calls} = await press({lastScoutAt: undefined}, trigger);
    const at = new Set(calls.map(c => c.env?.JOB_PILOTTO_SEARCH_AT));
    assert.equal(at.size, 1, `${trigger}: every step gets the same press time`);
    assert.equal(Number([...at][0]), Date.parse('2026-10-26T06:21:11Z') / 1000);
    for (const {step, args} of calls) assert.ok(flag(args, '--budget') > 0 && flag(args, '--budget') <= SEARCH_BUDGET_S, `${trigger}: ${step} has the press's clock`);
  }
});

test('the scout keeps its share when due, gets what is left, and waits (still due) when nothing is left', async () => {
  const {calls} = await press({lastScoutAt: stale()}, 'you', {discover: 50, daily: 90});
  assert.equal(flag(calls.find(c => c.step === 'daily').args, '--budget'), SEARCH_BUDGET_S - SCOUT_SHARE_S, 'daily leaves the scout its share');
  assert.equal(flag(calls.find(c => c.step === 'scout').args, '--budget'), 40, 'the scout gets what is left of the 3 minutes');
  const fresh = await press({lastScoutAt: new Date().toISOString()}, 'you');
  assert.equal(flag(fresh.calls.find(c => c.step === 'daily').args, '--budget'), SEARCH_BUDGET_S, 'no scout due: daily has the whole press');
  const before = stale();
  const late = await press({lastScoutAt: before}, 'you', {discover: 60, daily: 115});
  assert.ok(!late.calls.some(c => c.step === 'scout'), 'no scout with 5 s left');
  assert.equal(late.settings.lastScoutAt, before, 'still due: the next press runs it');
  assert.match(late.lines, /^⏱ Time is up \(2 min 55 s\) for finding more employers: it waits for the next search$/m);
});

test('on the first run, a step with no time left waits for the next search and says so', async () => {
  const {calls, lines} = await press({lastScoutAt: undefined}, 'first', {'daily --first-jobs': 178});
  assert.deepEqual(calls.map(c => c.step), ['daily --first-jobs']);
  assert.match(lines, /^⏱ Time is up \(2 min 58 s\) for job boards: it waits for the next search$/m);
});

// The app ends every step at the press's 180 s (27 Oct 2026, main's search check: persona 4 pressed for 181 s). The engine's own clock is only asked
// (src/time_budget.py); a step that forgot to ask is ended here. Each step is told how long it may still run, on the press's clock.
test('every step is ended at the press\'s 180 s, whatever the engine does with its clock', async () => {
  let clock = Date.parse('2026-10-27T10:00:00Z');
  const seen = [];
  const lines = [];
  await searchSteps(storage({lastScoutAt: stale()}), line => lines.push(line), 'run', 'you', async (_storage, args, _onLine, _env, opts = {}) => {
    seen.push({step: args[1], stopAfterMs: opts.stopAfterMs});
    clock += args[1] === 'discover' ? 50000 : 0;
    return {code: 0, result: {}, endedByTime: args[1] === 'daily'};
  }, {now: () => clock});
  assert.deepEqual(seen.map(s => s.step), ['discover', 'daily', 'scout']);
  assert.equal(seen[0].stopAfterMs, 175000, 'discover may run until the press\'s end, less the stop margin');
  assert.equal(seen[1].stopAfterMs, 125000, 'daily has what is left: 180 s minus the 5 s stop margin and the 50 s gone');
  assert.match(lines.join('\n'), /^⏱ Time is up \(.*\) for the search: what it has not reached waits for the next search$/m);
});

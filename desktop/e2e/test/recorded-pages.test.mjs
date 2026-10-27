// Layer 2: every recorded case (e2e/recorded/*) replayed with the real extension, offline (lib/page-replay.mjs). A fix to a site's shape adds its case here, seen
// failing on the build before the fix (REAL_EXTENSION_DIR=<old build>). Run: cd desktop/e2e && npm run recorded.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import fs from 'node:fs';
import {replayReason} from '../lib/applying-report.mjs';
import {loadCases, runCase} from '../lib/page-replay.mjs';
import {replayInTabs} from '../lib/replay-browser.mjs';
import {isRowCase, runRowCase} from '../lib/row-case-run.mjs';
import {parseShard, shardOf} from '../lib/replay-shard.mjs';
import {readSlow, splitForPr, touchedCases} from '../lib/replay-slow.mjs';

const extensionDir = process.env.REAL_EXTENSION_DIR || undefined;
const skip = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1 (npm run recorded); it starts Chromium with the real extension';
const results = [];   // CI writes them to JP_REPLAY_RESULTS; its report job sends every shard's in one PUT on a push to main (replays-report.mjs). A local run sends nothing.
after(() => {
  if (process.env.JP_REPLAY_RESULTS) fs.writeFileSync(process.env.JP_REPLAY_RESULTS, JSON.stringify(results));
  else if (results.length) console.log(`replays report: not sent (${replayReason() || 'no JP_REPLAY_RESULTS'})`);
});
// Write a conservative partial verdict immediately: a completed case survives a later sibling stall.
const remember = (item, result, pending = false) => {
  const entry = {name: item.name, control: item.control, ...(typeof result.seconds === 'number' ? {seconds: Math.round(result.seconds)} : {}),
    ok: pending ? false : result.ok, ...(Number.isInteger(item.rung) ? {rung: item.rung} : {}),
    note: pending ? 'awaiting final replay verdict' : result.failures.join('; ').slice(0, 200),
    fill: typeof result.fillTime === 'function' ? result.fillTime() : null,
    moves: !pending && result.ok && typeof result.moves === 'function' ? result.moves() : [],
    repairs: !pending && result.ok && typeof result.repairs === 'function' ? result.repairs() : []};
  const index = results.findIndex(one => one.name === item.name);
  if (index < 0) results.push(entry); else results[index] = entry;
  if (process.env.JP_REPLAY_RESULTS) fs.writeFileSync(process.env.JP_REPLAY_RESULTS, JSON.stringify(results));
};
const only = process.env.REPLAY_ONLY || '';   // a part of a case name: replay just those
// The cases run N tabs at a time in ONE browser (lib/replay-browser.mjs; JP_REPLAY_TABS, default 4; 1 = one browser per case, in turn, as before: said in the log). A case that fails in
// parallel is run again alone in its own browser: it counts as passed only if it passes alone, and it is said as FLAKY (never a silent pass).
const shard = parseShard(process.env.JP_REPLAY_SHARD || '');   // CI: JP_REPLAY_SHARD=i/n runs one slice of the cases (lib/replay-shard.mjs)
const picked = (process.env.JP_REPLAY_CASES || '').split(',').filter(Boolean);   // the exact cases a change can affect (lib/replay-select.mjs, tools/journey-gate.mjs); none: every case
const everyCase = loadCases().filter(one => one.name.includes(only) && (!picked.length || picked.includes(one.name)));
// A pull request (JP_REPLAY_PR_SPLIT=1, set by page-cases.yml for pull_request only) leaves the slow cases to main and the daily run unless it touches their folder (lib/replay-slow.mjs);
// JP_REPLAY_CHANGED holds the PR's changed files, one per line. It says which it left, whole: the split is on the whole set, then sharded.
const split = process.env.JP_REPLAY_PR_SPLIT && !picked.length ? splitForPr(everyCase, {slow: readSlow().slow, touched: touchedCases((process.env.JP_REPLAY_CHANGED || '').split('\n').filter(Boolean))}) : null;
if (split?.left.length && !skip) console.log(`left to main and the daily run (${split.left.length} slow cases, ${readSlow().basis}): ${split.left.map(one => one.name).join(', ')}`);
const planned = split ? split.run : everyCase;
const cases = shard ? shardOf(planned, shard.index, shard.count) : planned;
const pageCases = cases.filter(one => !isRowCase(one));   // a row case (case.json replay: "row", made by npm run row-to-case) is replayed on the row path, one at a time, below
const tabs = Math.max(1, Number(process.env.JP_REPLAY_TABS || 4));
const batchStarted = Date.now();
let batch = null;   // started by the first test, once: every test awaits its own case's result
// After the batch: a case that failed in parallel, or passed only through a line no case's host names (result.confirm), is run again alone, two at a time, in its own browser. It counts only if it passes alone.
const alone = async list => {
  const queue = list.filter(one => !one.ok || one.confirm?.length), done = new Map();
  await Promise.all(Array.from({length: Math.min(2, queue.length)}, async () => {
    for (let one = queue.shift(); one; one = queue.shift()) {
      console.log(`[replay ${one.name}] isolated retry start`);
      let again;
      try { again = await runCase(pageCases.find(item => item.name === one.name), {extensionDir}); }
      catch (error) { again = {ok: false, failures: [String(error.message || error)], seen: {tabs: 0, opened: 0}}; }
      done.set(one.name, {first: one, again});
      remember(pageCases.find(item => item.name === one.name), again);
      console.log(`[replay ${one.name}] isolated retry ${again.ok ? 'done' : 'FAIL'}`);
    }
  }));
  return done;
};
const batchResults = () => batch ||= tabs === 1 ? Promise.resolve(null) : replayInTabs(pageCases, {tabs, extensionDir, onResult: result => remember(pageCases.find(item => item.name === result.name), result, true)}).then(async list => {
  const slow = [...list].sort((a, b) => b.seconds - a.seconds).slice(0, 6).map(one => `${one.name} ${one.seconds.toFixed(0)}s`);   // where the batch's time goes
  console.log(`# recorded pages: ${list.length} cases in ${((Date.now() - batchStarted) / 1000).toFixed(0)} s; slowest: ${slow.join(', ')}`);
  const again = await alone(list);
  return new Map(list.map(result => {
    const second = again.get(result.name);
    if (!second) return [result.name, result];
    if (second.again.ok && !second.first.ok) console.log(`FLAKY in parallel: ${result.name} failed in ${tabs} tabs (${second.first.failures.join('; ').slice(0, 160)}) and passed alone; counted as passed`);
    if (second.again.ok && second.first.ok) console.log(`confirmed alone: ${result.name} (${second.first.confirm.join('; ').slice(0, 120)} came from a line no case's host names)`);
    return [result.name, second.again];
  }));
});
if (!skip) console.log(tabs === 1 ? 'recorded pages: JP_REPLAY_TABS=1, one browser per case, in turn' : `recorded pages: ${tabs} tabs at a time in one browser (JP_REPLAY_TABS=1: serial)`);
for (const item of cases) {
  test(`${item.name}: ${item.shape}`, {skip}, async () => {
    let result = isRowCase(item) ? await runRowCase(item, {extensionDir, ordinal: true}) : (await batchResults())?.get(item.name) || await runCase(item, {extensionDir});   // JP_REPLAY_TABS=1: one browser per case, in turn
    if (result.ordinal) console.log(`row case ${item.name}: WARNING: ${result.ordinal}`);
    if (result.loose) console.log(`row case ${item.name}: ${result.loose}`);   // a prompt or seed change since the capture: a warning, never a failure
    remember(item, result);
    assert.deepEqual(result.failures, [], `${item.name} (${item.why || ''})`);
  });
}

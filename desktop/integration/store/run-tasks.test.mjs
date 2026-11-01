// Layer 3 (Node + the real engine, no window): the three tasks a person presses (Find jobs, Check Gmail, Analyze my job search) each end in ONE Recent runs row, in plain words, with a clean
// log and nothing left Running. Moved from the e2e `activity` suite (1 Nov 2026, R2): its three task steps ("Find jobs (an empty feed: nothing new)", "Check Gmail & Calendar with no Google
// connection", "Analyze my job search": one Recent runs row, an end, plain words, a clean log, and no row left Running). The window side (the Actions page's compact banner, the layout)
// is screen-activity.test.js. The AI is the kit's proxy, which refuses what nobody answered: the Analyze report ends "paused" in words, which is a valid end for this check.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {assertNothingRunning, commonProblems, whatARunShows} from './engine-support.mjs';
import {startEngineKit} from './engine-kit.mjs';

let kit;
before(async () => { kit = await startEngineKit(); });
after(async () => { await kit?.close(); });

/** The checks every task gets: one new record of its kind, one store row of its mode, the common word/log problems, and nothing left Running. */
async function oneRowEnds(done, {kind, mode, announces}) {
  const seen = await whatARunShows(kit, done, {mode});
  const records = kit.appRuns().filter(run => run.kind === kind);
  const problems = commonProblems(kit, seen);
  if (records.length !== 1) problems.push(`expected exactly one Recent runs record of kind ${kind}, got ${records.length}`);
  if (!seen.app.log.length) problems.push('the Technical log is empty');
  if (announces && !announces.test(seen.app.log.join('\n'))) problems.push(`it never said what it was doing: its log has no "${announces.source}" line`);
  assert.deepEqual(problems, []);
  await assertNothingRunning(kit);
  return seen;
}

test('Find jobs (an empty feed: nothing new): one Recent runs row, an end, plain words, a clean log, and no row left Running', async () => {
  kit.feed([]);
  // announces: the line the finder says as it starts its work (src/scout.py run()): on the fixtures a search ends in seconds, too fast for any live timer, so a finder that printed
  // none of its steps passed (#352, the scout-silent mutant). Its own sentence, checked in the finished search's log.
  const seen = await oneRowEnds(await kit.runTask('refresh', 'run', 'you'), {kind: 'search', mode: 'run', announces: /Scout: checking \d+ employer/});
  assert.ok(seen.app.ok, 'the run did not end ok');
});

test('Check Gmail & Calendar with no Google connection: one Recent runs row, an end, plain words, a clean log, and no row left Running', async () => {
  const done = await kit.runTask('checkMail', 'you');
  assert.equal(done.run.off, true, 'a check with no Google connection should say Gmail is off');
  assert.match(done.lines.join('\n'), /Gmail \+ Calendar is off/);
  assert.equal(done.run.notionUrl, null, 'a check that read nothing should leave no store row');
  assert.ok(!/(?:Traceback|Error:)/.test(done.lines.join('\n')), 'the log shows a traceback');
  assert.equal(kit.appRuns().filter(run => run.kind === 'mail').length, 1);
  await assertNothingRunning(kit);
});

test('Analyze my job search: one Recent runs row, an end, plain words, a clean log, and no row left Running', async () => {
  await oneRowEnds(await kit.runWeekly(), {kind: 'weekly', mode: 'weekly'});
});

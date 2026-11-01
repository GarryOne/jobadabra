// Layer 3 (Node + the real engine + the Telegram fake, no window): a Jobs check while Telegram refuses the digest (a blocked bot, a bad token, an error on its side) still finds and stores the jobs,
// ends in words that name Telegram, and leaves nothing Running. The screen that draws such a run is screen-activity-failures.test.js; the send that works is run-channels.test.mjs.
// Job: serve stored answers
// Why (1 Nov 2026, owner: "We can build 10-20 more journeys. for the integrations"; Trello journey 27 "Receive and act on Telegram digests"): the store-level half of "Telegram refuses the digest" had no
// test: only the window's drawing of it did, from a hand-made run. This plays the cause: the real engine sends to a fake Telegram that answers the failures lib/telegram-fake.mjs lists.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {TELEGRAM_FAILURES} from '../../e2e/lib/telegram-fake.mjs';
import {assertNothingRunning, commonProblems, whatARunShows} from './engine-support.mjs';
import {startEngineKit} from './engine-kit.mjs';

let kit;
before(async () => {
  kit = await startEngineKit({telegram: true});
  // Why (1 Nov 2026, tj): the first Find jobs of a fresh install also runs the employer finder (search-steps.js: no lastScoutAt = due), whose own digest send (src/scout.py:295) is not guarded the way the
  // search's is (a46307b): a refused send there ends in a Python traceback with home-folder paths in the Technical log. That is a product bug outside this journey (reported with this PR, not played here);
  // the finder is marked as just run, so this file proves the search's digest, which is the one the person reads.
  // TODO(AI): drop the lastScoutAt line below once the finder's send says a refusal in words too (1 Nov 2026)
  kit.storage.saveSettings({lastScoutAt: new Date().toISOString()});
});
after(async () => { await kit?.close(); });

const REFUSALS = [
  {fault: 'blocked', what: 'Telegram says the bot was blocked by the person'},
  {fault: 'unauthorized', what: 'Telegram says the bot token is not valid (401)'},
  {fault: 'server-error', what: 'Telegram answers with an error of its own (500)'},
];

for (const {fault, what} of REFUSALS) {
  test(`${what}: the Jobs check still ends, in words that name Telegram, with nothing left Running`, async () => {
    assert.ok(TELEGRAM_FAILURES[fault], `the fake knows no failure called ${fault}`);
    kit.feed([`Senior Site Reliability Engineer, telegram ${fault}`]);
    const failedBefore = kit.telegram.stats.failed;
    kit.telegram.fail(fault);
    let done;
    try { done = await kit.runTask('refresh', 'run', 'you'); } finally { kit.telegram.pass(); }
    const seen = await whatARunShows(kit, done);
    const problems = commonProblems(kit, seen);
    if (kit.telegram.stats.failed - failedBefore < 1) problems.push('Telegram was never asked while failing, so nothing was tested');
    if (/^Completed$/.test(seen.pill)) problems.push('the run says plain "Completed" though its digest never reached the person');
    if (!/telegram/i.test(`${seen.words} ${seen.result}`)) problems.push(`nothing the person reads names Telegram: "${String(seen.result || seen.words).slice(0, 160)}"`);
    assert.deepEqual(problems, []);
    await assertNothingRunning(kit);
  });
}

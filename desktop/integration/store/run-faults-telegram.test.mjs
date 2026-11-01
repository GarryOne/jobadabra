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
// Why (1 Nov 2026, tj, #2908): the first Find jobs of a fresh install also runs the employer finder (search-steps.js: no lastScoutAt = due), whose own digest send (src/scout.py) ended in a Python
// traceback with home-folder paths in the Technical log. Every send now goes through telegram.deliver, so this journey plays that first press as it is: no setting hides the finder.
before(async () => { kit = await startEngineKit({telegram: true}); });
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
    kit.storage.saveSettings({lastScoutAt: ''});   // the employer finder is due again, as on a fresh install's first press: its digest send meets the refusal too (#2908)
    kit.telegram.fail(fault);
    let done;
    try { done = await kit.runTask('refresh', 'run', 'you'); } finally { kit.telegram.pass(); }
    const seen = await whatARunShows(kit, done);
    const problems = commonProblems(kit, seen);
    if (kit.telegram.stats.failed - failedBefore < 2) problems.push(`Telegram refused ${kit.telegram.stats.failed - failedBefore} send(s), the search digest and the employer finder's summary make 2: the finder did not run, so its send was not tested`);
    if (/^Completed$/.test(seen.pill)) problems.push('the run says plain "Completed" though its digest never reached the person');
    if (!/telegram/i.test(`${seen.words} ${seen.result}`)) problems.push(`nothing the person reads names Telegram: "${String(seen.result || seen.words).slice(0, 160)}"`);
    assert.deepEqual(problems, []);
    await assertNothingRunning(kit);
  });
}

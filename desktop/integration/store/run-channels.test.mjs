// Layer 3 (Node + the real engine + the Telegram and Google fakes, no window): with Telegram connected a Jobs check sends ONE readable digest to the person's chat, and the Gmail check reads the
// inbox through Google and ends in words with nothing left Running. Moved from the e2e `activityfailures` suite's channels part (suite failureschannels, 1 Nov 2026, R2): "with Telegram connected,
// a Jobs check sends one readable digest to the person's chat" and "the Gmail check reads the inbox through Google and ends in words, with nothing left Running". The Gmail e2e step is gone
// (night journey J16, Tier 2 since 1 Nov 2026: critical-journeys.json lists this test as its proof, the e2e suite failureschannels is deleted). Telegram refusing the digest and Google access revoked are drawn by screen-activity-failures.test.js.
// The AI is the kit's proxy, which refuses a call nobody answered: the Gmail check reads the three invented emails and the run still has to end in words.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {digestProblems} from '../../e2e/lib/telegram-fake.mjs';
import {CHAT, startEngineKit} from './engine-kit.mjs';
import {assertNothingRunning, commonProblems, whatARunShows} from './engine-support.mjs';

let kit;
before(async () => { kit = await startEngineKit({telegram: true, google: true}); });
after(async () => { await kit?.close(); });

test('with Telegram connected, a Jobs check sends one readable digest to the person\'s chat', async () => {
  kit.feed(['Senior Site Reliability Engineer, telegram digest']);
  const before = kit.telegram.sent.length;
  const done = await kit.runTask('refresh', 'run', 'you');
  const mine = kit.telegram.sent.slice(before).filter(item => item.chat === CHAT);
  const seen = await whatARunShows(kit, done);
  const problems = commonProblems(kit, seen);
  if (!mine.length) problems.push('no message reached the person\'s chat');
  const digests = mine.filter(item => /^✈️/.test(item.text.replace(/<[^>]+>/g, '').trim()));
  if (digests.length > 1) problems.push(`${digests.length} digests for one check`);
  for (const item of digests) for (const problem of digestProblems(item.text)) problems.push(`the digest: ${problem}`);
  assert.deepEqual(problems, []);
  assert.ok(digests.length === 1, `expected one digest, got ${digests.length}: ${mine.map(item => item.text.slice(0, 40))}`);
  assert.ok(done.ok, 'the run did not end ok');
});

test('the Gmail check reads the inbox through Google and ends in words, with nothing left Running', async () => {
  const before = kit.google.stats.read;
  const done = await kit.runTask('checkMail', 'you');
  const seen = await whatARunShows(kit, done, {mode: 'mail'});
  const problems = commonProblems(kit, seen);
  if (kit.google.stats.read - before < 1) problems.push('no email was read, so nothing was tested');
  if (!done.ok) problems.push(`the check did not end ok ("${seen.result || seen.words.slice(0, 120)}")`);
  assert.deepEqual(problems, []);
  await assertNothingRunning(kit);
});

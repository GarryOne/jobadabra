// Commit-time check of trailer values (tools/commit-trailers.mjs): a wrong value fails when the message is written, not at the push gate.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {messageProblems} from '../../tools/commit-trailers.mjs';

const IDS = ['aldi-suisse', 'trap-press-address-de'];
const bad = message => messageProblems(message, IDS).join('\n');

test('a message with no trailers, or good ones, has no problem', () => {
  assert.deepEqual(messageProblems('Fix a label\n\nbody', IDS), []);
  assert.deepEqual(messageProblems('Fix\n\nRung: 3, router\nFixture: aldi-suisse, trap-press-address-de\nPool-row: Acme Corp\nRecorded-unneeded: a log line\nE2E-issue: none the step is unrelated\nWhy-changed: #2201 link box — the owner moved it to the shared rule', IDS), []);
  assert.deepEqual(messageProblems('Fix\n\nRung: none: a log line\nFixture: none: a pure move', IDS), []);
});

test('every wrong value names its line (the "Rung: 1 " that cost a ship cycle is not the only one)', () => {
  for (const [message, pattern] of [
    ['x\n\nRung: 7', /"Rung: 7" is not 0-6/], ['x\n\nRung: one', /"Rung: one"/], ['x\n\nRung: none', /"Rung: none" needs a reason/],
    ['x\n\nFixture: nope', /no fixture "nope"/], ['x\n\nFixture: none', /"Fixture: none" needs a reason/],
    ['x\n\nPool-row: https://a.example/jobs?id=1', /Pool-row/], ['x\n\nPool-row:', /Pool-row/],
    ['x\n\nRecorded-unneeded:', /Recorded-unneeded/], ['x\n\nRecorded-pins:', /Recorded-pins/], ['x\n\nE2E-issue: none', /E2E-issue/], ['x\n\nE2E-issue: 12', /E2E-issue/],
    ['x\n\nWhy-changed:', /Why-changed/], ['x\n\nWhy-changed: x', /Why-changed/],
  ]) assert.match(bad(message), pattern, message);
});

test("git's own comment lines are not the message", () => {
  assert.deepEqual(messageProblems('Fix\n\n# Rung: 9\n# Please enter the commit message', IDS), []);
});

test('a trailer name inside a sentence is not a trailer', () => {
  assert.deepEqual(messageProblems('Fix\n\nthe Rung: line is checked at commit time', IDS), []);
});

// 11 Oct 2026: e5e68c7 named its row "ashby-form-in-an-embedded-app" (the capture folder's slug), and the Fixed tab showed Ashby twice.
const POOL = {names: ['Ashby form in an embedded app', 'Hornbach SuccessFactors', 'Acme Corp'], complete: true};
test('a Pool-row value must be a row name of the pool; a slug or a typo is refused with the row it means', () => {
  assert.deepEqual(messageProblems('Fix\n\nPool-row: Ashby form in an embedded app', IDS, POOL), []);
  assert.match(messageProblems('Fix\n\nPool-row: ashby-form-in-an-embedded-app', IDS, POOL).join('\n'), /not a row name of the pool.*did you mean "Pool-row: Ashby form in an embedded app"/);
  assert.match(messageProblems('Fix\n\nPool-row: Hornbach Successfactor', IDS, POOL).join('\n'), /did you mean "Pool-row: Hornbach SuccessFactors"/);
});

test('without this Mac\'s own list only a slug of a known row is refused (another machine cannot know every row)', () => {
  const partial = {names: POOL.names, complete: false};
  assert.deepEqual(messageProblems('Fix\n\nPool-row: A row only the owner\'s Mac lists', IDS, partial), []);
  assert.match(messageProblems('Fix\n\nPool-row: hornbach-successfactors', IDS, partial).join('\n'), /did you mean "Pool-row: Hornbach SuccessFactors"/);
});

test('every row of the public pool is accepted as itself and refused as its slug', async () => {
  const {poolRowNames, slugOf} = await import('../../tools/pool-rows.mjs');
  const {names} = poolRowNames({env: {RECORD_SITES: '/no/such/file'}});
  assert.ok(names.length > 3, 'the public pool is read');
  for (const name of names) {
    assert.deepEqual(messageProblems(`Fix\n\nPool-row: ${name}`, IDS, {names, complete: true}), [], name);
    if (slugOf(name) !== name) assert.match(messageProblems(`Fix\n\nPool-row: ${slugOf(name)}`, IDS, {names, complete: true}).join('\n'), /did you mean/, name);
  }
});

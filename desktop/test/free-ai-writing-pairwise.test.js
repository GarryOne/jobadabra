// The head-to-head writing comparison (tools/free-ai-writing-pairwise.mjs): the judge's A/B answer is validated and asked once more, and the tally counts per feature.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compare, tally} from '../../tools/free-ai-writing-pairwise.mjs';

const item = {feature: 'letter', trap: 't', params: {system: [{text: 'sys'}], messages: [{content: 'user'}]}};
const runWith = replies => { const seen = []; const run = async (model, input) => { seen.push(input); return {choices: [{message: {content: replies.shift()}}]}; }; run.seen = seen; return run; };

test('the judge shows both texts, labelled A and B, and returns its pick', async () => {
  const run = runWith(['{"winner":"B","reason":"more specific"}']);
  assert.equal((await compare(item, 'first text', 'second text', run, 'claude:sonnet')).winner, 'B');
  const prompt = run.seen[0].messages[1].content;
  assert.ok(prompt.indexOf('# Text A\nfirst text') < prompt.indexOf('# Text B\nsecond text'));
});

test('a bad answer is asked once more, then the pair is not counted', async () => {
  const again = runWith(['{"winner":"C","reason":"x"}', '{"winner":"tie","reason":"equal"}']);
  assert.equal((await compare(item, 'a', 'b', again, 'claude:sonnet')).winner, 'tie');
  assert.equal(again.seen.length, 2);
  assert.equal(await compare(item, 'a', 'b', runWith(['not json', '{}']), 'claude:sonnet'), null);
});

test('the tally counts wins and ties per feature', () => {
  const rows = [{feature: 'letter', winner: 'a'}, {feature: 'letter', winner: 'b'}, {feature: 'letter', winner: 'tie'}, {feature: 'prep', winner: 'b'}];
  assert.deepEqual(tally(rows), {letter: {a: 1, b: 1, tie: 1, n: 3}, prep: {a: 0, b: 1, tie: 0, n: 1}});
});

test('--more-letters gives 15 letter cases, each with its own trap; the default stays 5 per feature', async () => {
  const {allCases} = await import('../../tools/free-ai-writing-cases.mjs');
  const letters = allCases({more: true}).filter(item => item.feature === 'letter');
  assert.equal(letters.length, 15);
  assert.equal(new Set(letters.map(item => item.id)).size, 15);
  assert.ok(letters.every(item => item.trap.length > 40 && item.params.messages.length > 0));
  assert.equal(allCases().filter(item => item.feature === 'letter').length, 5);
});

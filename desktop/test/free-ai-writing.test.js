// The Free AI writing eval (tools/free-ai-writing-*.mjs): the rubric answers are fixed and validated, a judge that misses a criterion is asked once more, the cases cover every prose feature, and the table counts per criterion.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {allCases} from '../../tools/free-ai-writing-cases.mjs';
import {CRITERIA, judge, proseOf, validate} from '../../tools/free-ai-writing-judge.mjs';
import {table} from '../../tools/free-ai-writing-eval.mjs';

const good = {voice: 'yes', supported: 'no', fit_honest: 'yes', specific: 'yes', style: 'yes', clean: 'yes', unsupported: ['40%'], comment: 'invents 40%'};
const runWith = replies => { const seen = []; const run = async (model, input) => { seen.push(input); return {choices: [{message: {content: replies.shift()}}]}; }; run.seen = seen; return run; };

test('a rubric answer needs a yes or no for every criterion and a list of unsupported claims', () => {
  assert.deepEqual(validate(good), []);
  assert.deepEqual(validate({...good, voice: 'maybe'}), ['voice']);
  assert.deepEqual(validate({...good, unsupported: 'x'}), ['unsupported']);
  assert.deepEqual(Object.keys(CRITERIA), ['voice', 'supported', 'fit_honest', 'specific', 'style', 'clean']);
});

test('the judge asks again once when an answer misses a criterion, then gives up with null', async () => {
  const item = {feature: 'letter', trap: 't', params: {system: [{text: 'sys'}], messages: [{content: 'user'}]}};
  const again = runWith(['{"voice":"yes"}', JSON.stringify(good)]);
  assert.deepEqual(await judge(item, {cover_letter: 'I run it.'}, again), good);
  assert.equal(again.seen.length, 2);
  assert.equal(await judge(item, {}, runWith(['not json', '{}'])), null);
});

test('the judge reads the text the person would read: the prose fields in order, eligible included', () => {
  assert.equal(proseOf('letter', {eligible: false, cover_letter: 'Hello', answers: [{answer: 'A1', category: 'normal'}]}), 'eligible: false\ncover_letter: Hello\nanswer: A1\ncategory: normal');
});

test('the cases: 5 for each prose feature (weekly 6: its door), every one with the trap the judge is told about and the real prompt in the request', {skip: process.platform === 'win32' && 'the cases are built by the Python engine (mac and Linux run this)'}, () => {
  const cases = allCases();
  const byFeature = Object.groupBy(cases, item => item.feature);
  assert.deepEqual(Object.fromEntries(Object.entries(byFeature).map(([name, list]) => [name, list.length])), {letter: 5, review: 5, prep: 5, weekly: 6, rejection: 5});
  for (const item of cases) {
    assert.ok(item.trap.length > 30, item.id);
    assert.match(item.params.system.map(part => part.text).join('\n'), /Writing rules \(every text you write for the person\)/, `${item.id} carries the shared writing rules`);
    assert.ok(item.params.output_config.format.schema, item.id);
  }
});

test('the table counts per writer how many cases pass each criterion and all six', () => {
  const cases = [{id: 'a', feature: 'letter'}, {id: 'b', feature: 'letter'}];
  const all = Object.fromEntries(Object.keys(CRITERIA).map(key => [key, 'yes']));
  const text = table(cases, {a: {free: all, sonnet: all}, b: {free: {...all, supported: 'no'}, sonnet: all}});
  assert.match(text, /\| letter \| free \| 2 \| 2\/2 \| 1\/2 \| 2\/2 \| 2\/2 \| 2\/2 \| 2\/2 \| 1\/2 \|/);
  assert.match(text, /\| letter \| sonnet \| 2 \| 2\/2 \| 2\/2 \| 2\/2 \| 2\/2 \| 2\/2 \| 2\/2 \| 2\/2 \|/);
});

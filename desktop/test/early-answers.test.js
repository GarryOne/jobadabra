// The form's questions asked early (apply-latency D, extension/early-answers.js): an early answer is used once, only for the same tab, page and exactly
// the same open questions, within a minute; a failed one makes the fill ask again. consider() starts it only on a page that already shows a form, and
// fillTab takes it instead of asking: a new caller that asks /extension/answer on its own path fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

import {hasEarly, keepEarly, takeEarly} from '../../extension/early-answers.js';

const open = [{field: 'q1'}, {field: 'q2'}];

test('an early answer is taken once, for the same page and questions, within a minute', async () => {
  keepEarly(7, 'https://jobs.example.com/apply#x', open, Promise.resolve({answers: ['a']}), 0);
  assert.equal(hasEarly(7, 'https://jobs.example.com/apply', 1000), true);
  assert.deepEqual(await takeEarly(7, 'https://jobs.example.com/apply', [{field: 'q2'}, {field: 'q1'}], 1000), {answers: ['a']}, 'order of the questions does not matter');
  assert.equal(takeEarly(7, 'https://jobs.example.com/apply', open, 1000), null, 'once');
});

test('another set of questions, another page, a late or a failed answer: the fill asks as before', async () => {
  keepEarly(8, 'https://jobs.example.com/a', open, Promise.resolve({}), 0);
  assert.equal(takeEarly(8, 'https://jobs.example.com/a', [{field: 'q1'}], 10), null, 'the form changed');
  keepEarly(8, 'https://jobs.example.com/a', open, Promise.resolve({}), 0);
  assert.equal(takeEarly(8, 'https://jobs.example.com/b', open, 10), null, 'another page');
  keepEarly(8, 'https://jobs.example.com/a', open, Promise.resolve({}), 0);
  assert.equal(takeEarly(8, 'https://jobs.example.com/a', open, 60001), null, 'older than a minute');
  keepEarly(8, 'https://jobs.example.com/a', open, Promise.reject(new Error('limit')), 0);
  assert.equal(await takeEarly(8, 'https://jobs.example.com/a', open, 10), null, 'a failed early answer resolves to null: the fill asks again');
});

test('consider starts it only on a page showing a form; fillTab takes it before asking; one path asks /extension/answer', () => {
  const flow = fs.readFileSync(new URL('../../extension/flow.js', import.meta.url), 'utf8');
  const fill = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  assert.match(fill, /if \(counts\.fields \+ counts\.textareas >= 2 && !counts\.passwords\) askEarly\(/);
  assert.match(flow, /pendingAI = askedEarly \? askedEarly\.then\(found => found \|\| askAnswers\(tab, config, open\)\) : askAnswers\(tab, config, open\)/);
  assert.equal((flow.match(/'\/extension\/answer'/g) || []).length, 1, 'the answers are asked in one place (askAnswers), for the fill and the early ask alike');
  assert.match(flow, /if \(kitStance\(\{kitAnswers: kit\?\.kit\?\.answers \|\| \[\], hasKit: !!kit\?\.kit\}\)\.withKit\) return false;/, 'never early with a kit');
});

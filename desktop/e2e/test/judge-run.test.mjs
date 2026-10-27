// judge.mjs, the workflows' judge: the setup falls back to Free AI without a Claude key, verdicts come out in the text the loop reads, and a provider limit
// stops the run and is recorded for the breaker (ai-budget.mjs --judge).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {judgeAll, setupOf} from '../judge.mjs';
import {parse} from '../lib/verdict-comment.mjs';

const finding = {id: 'f1', source: 'ai-review', kind: 'text', severity: 'medium', view: 'jobs', title: 'Raw error shown', detail: 'It reads "HTTP 500".'};
const excerpts = () => [{file: 'desktop/renderer/pages/jobs.js', from: 1, to: 20, lines: Array(20).fill('x')}];

test('the setup: free unless a Claude key is there for Haiku', () => {
  assert.equal(setupOf({}), 'free');
  assert.equal(setupOf({UI_JUDGE_SETUP: 'free+haiku'}), 'free');
  assert.equal(setupOf({UI_JUDGE_SETUP: 'free+haiku', UI_LOOP_ANTHROPIC_KEY: 'k'}), 'free+haiku');
  assert.equal(setupOf({UI_JUDGE_SETUP: 'nonsense', UI_LOOP_ANTHROPIC_KEY: 'k'}), 'free');
});

test('each finding gets the verdict text the loop already reads, and the run its cost', async () => {
  const ask = {free: async () => ({ok: true, usd: 0.001, text: '{"verdict":"real","why":"the page prints the raw status","cite":"desktop/renderer/pages/jobs.js:12","severity":"high","sure":"high"}'}),
    haiku: async () => { throw new Error('Haiku must not be asked when Free AI is sure'); }};
  const {verdicts, run} = await judgeAll([{key: 'f1', finding, logs: '', png: ''}], {setup: 'free+haiku', rules: 'R', ask, excerpts});
  assert.equal(parse(verdicts.f1).word, 'real');
  assert.equal(parse(verdicts.f1).severity, 'high');
  assert.deepEqual([run.calls, run.by.free, run.limit], [1, 1, '']);
});

test('a provider limit stops the run: the rest is filed unjudged and the breaker learns why', async () => {
  let asked = 0;
  const ask = {free: async () => { asked++; return {ok: false, status: 429, detail: 'you have used up your daily free allocation of neurons'}; }, haiku: async () => ({ok: false, status: 400, detail: 'Your credit balance is too low'})};
  const items = ['a', 'b', 'c'].map(key => ({key, finding, logs: '', png: ''}));
  const {verdicts, run} = await judgeAll(items, {setup: 'free', rules: 'R', ask, excerpts});
  assert.deepEqual(verdicts, {});
  assert.equal(asked, 1);
  assert.match(run.limit, /free: 429/);
  assert.equal(run.failed.length, 3);
});

test('Haiku capped or refused: Free AI judges instead and the breaker is not tripped', async () => {
  const ask = {haiku: async () => ({ok: false, status: 400, detail: 'Your credit balance is too low'}),
    free: async () => ({ok: true, usd: 0.001, text: '{"verdict":"false-positive","why":"a toast that goes away","cause":"by-design","sure":"high"}'})};
  const {verdicts, run} = await judgeAll([{key: 'f1', finding, logs: '', png: ''}], {setup: 'haiku', rules: 'R', ask, excerpts});
  assert.equal(parse(verdicts.f1).word, 'false-positive');
  assert.deepEqual([run.by.free, run.limit], [1, '']);
  assert.match(run.failed[0], /Haiku refused .*credit balance/);
});

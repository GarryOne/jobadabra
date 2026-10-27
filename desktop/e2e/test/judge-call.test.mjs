// The one-call judge (lib/judge-call.mjs, lib/judge-ask.mjs, lib/judge-cases.mjs): the rules come from ui-verdict-prompt.md, code decides what is trusted,
// Free AI goes first and Haiku answers only when it is unsure, and the answer key reads people's resolutions.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {judgeRequest, loadRules, readJudge, safeToDrop, unsure, verdictText} from '../lib/judge-call.mjs';
import {judgeWith, LIMIT} from '../lib/judge-ask.mjs';
import {answerOf, casesFrom, lessonsWithout, truthOf} from '../lib/judge-cases.mjs';
import {excerptsFor, needlesOf} from '../lib/judge-excerpts.mjs';
import {parse} from '../lib/verdict-comment.mjs';

const excerpts = [{file: 'desktop/renderer/pages/ready-card.js', from: 70, to: 90, lines: Array(21).fill('x'), why: 'has "Not available"'}];
const finding = {source: 'ai-review', kind: 'text', severity: 'medium', view: 'actions', title: 'Internal text shown', detail: "The row reads 'Not in the end-to-end journey'."};

test('the rules are the verdict prompt without its tool steps, and the answer is fixed JSON', () => {
  const rules = loadRules();
  assert.match(rules, /JOB SEEKER TEST/);
  assert.match(rules, /Severity: high\|medium\|low/);
  assert.doesNotMatch(rules, /HOW \(you have|grep desktop\/renderer\/index\.html|Write \.heal/);
  const request = judgeRequest({finding, rules, excerpts, png: 'iVBOR', model: 'm'});
  assert.match(request.system[0].text, /ONE JSON object/);
  assert.equal(request.messages[0].content[0].type, 'image');
  assert.match(request.messages[0].content[1].text, /ready-card\.js:70-90[\s\S]*^70: x/m);
});

test('code decides what is trusted: broken JSON, unknown words and unshown cites become needs-human', () => {
  assert.equal(readJudge('no json here', {excerpts}).word, 'needs-human');
  assert.equal(readJudge('{"verdict":"maybe","why":"w","sure":"high"}', {excerpts}).word, 'needs-human');
  const unshown = readJudge('{"verdict":"real","why":"w","cite":"desktop/renderer/pages/ready-card.js:200","sure":"high"}', {excerpts});
  assert.equal(unshown.word, 'needs-human');
  assert.match(unshown.note, /not a line it was shown/);
  const shown = readJudge('<think>hm</think>{"verdict":"real","why":"jargon","cite":"desktop/renderer/pages/ready-card.js:81","severity":"medium","sure":"high"}', {excerpts});
  assert.equal(shown.word, 'real');
  assert.equal(unsure(shown), false);
  assert.equal(unsure({...shown, sure: 'medium'}), true);
  const text = verdictText(shown, 'free');
  assert.equal(parse(text).word, 'real');
  assert.equal(parse(text).severity, 'medium');
  assert.match(parse(text).why, /ready-card\.js:81/);
});

test('Free AI first; Haiku only when Free AI is unsure or fails', async () => {
  const say = (verdict, sure) => async () => ({ok: true, text: JSON.stringify({verdict, why: 'w', sure, cause: 'by-design'}), usd: 0.001});
  let haikuAsked = 0;
  const haiku = async () => { haikuAsked++; return {ok: true, text: '{"verdict":"false-positive","why":"h","sure":"high"}', usd: 0.002}; };
  const sure = await judgeWith('free+haiku', {}, excerpts, {free: say('false-positive', 'high'), haiku});
  assert.deepEqual([sure.by, sure.calls, haikuAsked], ['free', 1, 0]);
  const doubtful = await judgeWith('free+haiku', {}, excerpts, {free: say('false-positive', 'low'), haiku});
  assert.deepEqual([doubtful.by, doubtful.calls, doubtful.firstSaid], ['haiku', 2, 'false-positive']);
  assert.equal(doubtful.usd, 0.003);
  const failed = await judgeWith('free', {}, excerpts, {free: async () => ({ok: false, status: 400, detail: 'Credit balance is too low'}), haiku});
  assert.equal(failed.limit, true);
  assert.ok(LIMIT.test('4006: you have used up your daily free allocation of 10,000 neurons'));
});

test('the answer key: fixed is real, by-design and fp:* are false, the rest settles nothing', () => {
  assert.equal(truthOf([{name: 'resolution:fixed'}]), 'real');
  assert.equal(truthOf([{name: 'resolution:by-design'}]), 'false');
  assert.equal(truthOf([{name: 'resolution:fp:harness'}]), 'false');
  assert.equal(truthOf([{name: 'resolution:not-seen'}]), '');
  const body = "🟠 **MEDIUM** · text · found by the AI review\n\n> 📍 Page `actions` · suite `x`\n> 🏷️ Build tested: main @ abc1234 (schedule run)\n\n### What was found\nIt reads 'Not available'.\n\n### Evidence\n![a](https://raw.githubusercontent.com/o/r/b/ui-loop/x/1-failed-the-icon-rail-every-badge-cle.png)\n";
  const [item] = casesFrom([{number: 7, title: '[auto-ui] actions: Internal text', labels: [{name: 'source:suite-failure'}, {name: 'resolution:fixed'}], body, createdAt: '2026-10-20T00:00:00Z',
    comments: [{body: '<!-- ui-loop-verdict:false-positive -->\n> x\n<sub>UI loop · verdict pass · read-only, it changed no code</sub>'}]}]);
  assert.deepEqual([item.truth, item.sha, item.finding.view, item.finding.severity, item.finding.step, item.agent], ['real', 'abc1234', 'actions', 'medium', 'the icon rail every badge', 'false-positive']);
  assert.equal(lessonsWithout('- #7 was real\n- #70 was false', 7), '- #70 was false');
  const kept = new Map([['7|free', {ok: true, usd: 0.001, judged: {word: 'real', sure: 'low'}}], ['7|haiku', {ok: true, usd: 0.002, judged: {word: 'false-positive', sure: 'high'}}]]);
  assert.deepEqual(answerOf('free+haiku', 7, kept, {unsure}), {word: 'false-positive', usd: 0.003, asked: 2});
});

test('excerpts come from the finding\'s own words, at the tested build', () => {
  const needles = needlesOf({title: 'x', detail: 'div.run-mode-main shows \'Fill now\'; sidebar-rail.js and src/a.py:12 call host_pace.open()'});
  assert.deepEqual(needles.refs, [{ref: 'src/a.py', line: 12}]);
  assert.deepEqual(needles.files, ['sidebar-rail.js']);
  assert.ok(needles.words.includes('Fill now') && needles.words.includes('run-mode-main') && needles.words.includes('open('));
  const calls = [];
  const git = args => { calls.push(args); if (args[0] === 'grep') return 'abc:desktop/renderer/pages/a.js:30:Fill now\nabc:desktop/renderer/test/a.test.js:3:Fill now\n'; if (args[0] === 'show') return Array(60).fill('line').join('\n'); return ''; };
  const got = excerptsFor({source: 'ai-review', title: "'Fill now' is off", detail: ''}, {ref: 'abc', git});
  assert.deepEqual(got.map(item => [item.file, item.from, item.to]), [['desktop/renderer/pages/a.js', 20, 40]]);
  assert.ok(calls.some(args => args[0] === 'show' && args[1] === 'abc:desktop/renderer/pages/a.js'));
});

test('a judge that lacks the code asks once; code fetches it and the same model decides', async () => {
  const answers = ['{"need":["Not in the end-to-end journey","blocked("]}', '{"verdict":"harness","why":"the text is the test build\'s reason","sure":"high"}'];
  const seen = [];
  const free = async request => { seen.push(request.system[0].text); return {ok: true, usd: 0.001, text: answers.shift()}; };
  let asked = null;
  const more = need => { asked = need; return {excerpts, request: judgeRequest({finding, rules: 'R', excerpts, last: true})}; };
  const result = await judgeWith('free', judgeRequest({finding, rules: 'R', excerpts}), excerpts, {free}, more);
  assert.deepEqual(asked, ['Not in the end-to-end journey', 'blocked(']);
  assert.deepEqual([result.judged.word, result.calls, result.asked.length], ['harness', 2, 2]);
  assert.match(seen[0], /you may ask ONCE/);
  assert.match(seen[1], /last round/);
  assert.equal(readJudge('{"need":["x"]}').word, 'needs-human', 'a need is never mistaken for a verdict');
});

test('a finding is dropped only when the judge is sure it is false (4 real bugs were lost otherwise, 27 Oct 2026)', () => {
  const said = (word, sure) => ({word, sure, why: 'w', cite: '', cause: '', severity: '', note: ''});
  assert.equal(safeToDrop(said('false-positive', 'medium')).word, 'needs-human');
  assert.equal(safeToDrop(said('harness', 'low')).word, 'needs-human');
  assert.equal(safeToDrop(said('false-positive', 'high')).word, 'false-positive');
  assert.equal(safeToDrop(said('real', 'medium')).word, 'real');
});

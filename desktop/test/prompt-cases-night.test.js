// The nightly prompt-case replay (tools/prompt-cases-night.mjs, tools/prompt-cases-codex.mjs, prompt-cases-night.yml): report only, $0 when no live prompt changed, Codex not a paid API,
// run by the night pass 1 only. Owner via mac-07, 1 Nov 2026: "Let the prompts being checked nightly and report". Played offline with fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compareNight, liveChanged, reportLine, runNight} from '../../tools/prompt-cases-night.mjs';
import {brokerBody, codexRun} from '../../tools/prompt-cases-codex.mjs';
import {pool} from '../../tools/prompt-cases-live.mjs';

const root = new URL('../../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const items = ids => ids.map(id => ({id}));
const baseline = {version: 1, set: 'form', sha: 'aaaaaaa1111', results: {a: true, b: true, c: false}, total: 3, right: 2};
const asker = (wrong, calls = []) => async item => { calls.push(item.id); return {id: item.id, right: !wrong.includes(item.id)}; };

test('a case right last night and wrong twice is flipped; right on the re-ask is model noise; a new wrong case is named', () => {
  const first = [{id: 'a', right: false}, {id: 'b', right: false}, {id: 'c', right: false}, {id: 'd', right: false}, {id: 'e', right: true}];
  const out = compareNight(baseline.results, first, [{id: 'a', right: true}, {id: 'b', right: false}]);
  assert.deepEqual([out.flipped, out.noise, out.newWrong], [['b'], ['a'], ['d']]);
  assert.equal(out.right, 2, 'a (noise) and e are right');
  assert.deepEqual(compareNight(null, first).newWrong, [], 'the first night has no baseline to be new against');
});

test('no live prompt changed: nothing is asked, the baseline is carried forward at $0', async () => {
  const calls = [];
  const report = await runNight({baseline, sha: 'bbbbbbb2222', changed: false, cases: items(['a', 'b', 'c']), ask: asker([], calls), pool});
  assert.equal(calls.length, 0);
  assert.equal(report.status, 'carried');
  assert.equal(report.sha, 'aaaaaaa1111', 'the results still reflect the baseline commit');
  assert.deepEqual(report.results, baseline.results);
  assert.match(reportLine(report), /no prompt changed since aaaaaaa: baseline carried, \$0/);
});

test('a changed prompt asks every case once and the flipped ones once more; the report counts the calls', async () => {
  const calls = [];
  const report = await runNight({baseline, sha: 'bbbbbbb2222', changed: true, cases: items(['a', 'b', 'c']), ask: asker(['b'], calls), pool, jobs: 1});
  assert.deepEqual(calls, ['a', 'b', 'c', 'b'], 'b was right last night: asked again');
  assert.equal(report.status, 'asked');
  assert.deepEqual([report.flipped, report.noise, report.calls, report.sha], [['b'], [], 4, 'bbbbbbb2222']);
  assert.equal(reportLine(report), 'Prompt cases (form, Codex): 3 cases, 1 flipped, 0 model noise; 4 calls');
});

test('the first night stores a baseline and flips nothing', async () => {
  const report = await runNight({baseline: null, sha: 'bbbbbbb2222', changed: true, cases: items(['a', 'b']), ask: asker(['b']), pool});
  assert.equal(report.status, 'first');
  assert.deepEqual([report.flipped, report.results], [[], {a: true, b: false}]);
  assert.match(reportLine(report), /first night, baseline stored \(1 right\)/);
});

test('a broker refusal is said, never a partial or green report, and the old baseline is kept', async () => {
  const ask = async item => { if (item.id === 'b') throw new Error('capped: broker: budget:week'); return {id: item.id, right: true}; };
  const report = await runNight({baseline, sha: 'bbbbbbb2222', changed: true, cases: items(['a', 'b', 'c']), ask, pool, jobs: 1});
  assert.equal(report.status, 'not-asked');
  assert.match(report.reason, /budget:week/);
  assert.equal(report.sha, 'aaaaaaa1111');
  assert.deepEqual(report.results, baseline.results);
  assert.match(reportLine(report), /NOT asked .*budget:week.*baseline aaaaaaa kept/);
  const over = await runNight({baseline: null, sha: 'x', changed: true, cases: items(['a', 'b', 'c']), ask: asker([]), pool, maxCalls: 2});
  assert.equal(over.status, 'not-asked', 'over the call cap is said too');
  assert.equal(over.calls, 0);
});

test('a baseline commit git does not know counts as changed: not judged is asked, never read on a guess', () => {
  assert.equal(liveChanged(fs.mkdtempSync(`${process.env.TMPDIR || '/tmp'}/pc-night-`), 'deadbeef'), true);
});

test('Codex is asked in Messages shape: system apart, the schema as output_config, the Haiku tier; a refusal carries .capped', async () => {
  const input = {messages: [{role: 'system', content: 'S1'}, {role: 'user', content: 'U'}, {role: 'system', content: 'S2'}], response_format: {json_schema: {schema: {type: 'object'}}}};
  const body = brokerBody(input);
  assert.deepEqual([body.system, body.messages, body.output_config.format.schema, body.model], ['S1\n\nS2', [{role: 'user', content: 'U'}], {type: 'object'}, 'claude-haiku-5-5']);
  let calls = 0;
  const answer = await codexRun({ask: async () => ({ok: true, model: 'gpt-6-luna', message: {content: [{type: 'text', text: '{"a":1}'}], usage: {input_tokens: 5, output_tokens: 2}}}), onCall: () => { calls += 1; }})('m', input);
  assert.deepEqual([answer.choices[0].message.content, answer.usage, calls], ['{"a":1}', {prompt_tokens: 5, completion_tokens: 2}, 1]);
  await assert.rejects(codexRun({ask: async () => ({ok: false, status: 'capped', detail: 'broker: budget:own-share'})})('m', input), error => error.capped === true && /budget:own-share/.test(error.message));
});

test('only the night pass 1 calls it: report only, nothing needs it, no PR trigger, no API key', () => {
  const caller = read('.github/workflows/e2e.yml'), at = caller.indexOf('  prompt-cases-night:');
  assert.ok(at > 0, 'e2e.yml calls prompt-cases-night.yml');
  const block = caller.slice(at, caller.indexOf('\n\n', at) > 0 ? caller.indexOf('\n\n', at) : undefined);
  assert.match(block, /if: inputs\.night_pass == '1\/5'/);
  assert.match(block, /uses: \.\/\.github\/workflows\/prompt-cases-night\.yml/);
  assert.match(block, /id-token: write/);
  assert.ok(!/needs: \[[^\]]*prompt-cases-night/.test(caller) && !/needs: prompt-cases-night/.test(caller), 'nothing waits for it');
  const wf = read('.github/workflows/prompt-cases-night.yml');
  assert.ok(!/pull_request|push:|schedule:/.test(wf.split('\njobs:')[0]), 'no PR, push or cron trigger');
  assert.match(wf, /continue-on-error: true/);
  assert.ok(!/ANTHROPIC|PR_PROOF/.test(wf.replace(/^\s*#.*$/gm, '')), 'Codex plan only, never an API key (the no-step-summary rule is tests/test_no_step_summaries.py)');
});

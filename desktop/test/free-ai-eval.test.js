// The Free AI quality tool (tools/free-ai-eval.mjs): validity, rank metrics, the table, and a run against the mock backend.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluate, mock, rest} from '../../tools/free-ai-eval.mjs';
import {schemaProblems, spearman, summarize, table, topOverlap} from '../../tools/free-ai-eval-metrics.mjs';
import {SMALL, STRONG} from '../lib/free-ai-models.js';

const schema = {type: 'object', required: ['score', 'tier'], properties: {score: {type: 'integer'}, tier: {type: 'string', enum: ['A', 'B', 'C']}, tags: {type: 'array', items: {type: 'string'}}}};
const cases = Array.from({length: 8}, (_, i) => ({id: `job-${i}`, baseline: 10 + i * 10, params: {max_tokens: 100, output_config: {format: {type: 'json_schema', schema}},
  messages: [{role: 'user', content: `Posting [case job-${i}]`}]}}));

test('schemaProblems names what is wrong: a missing key, a wrong type, a value outside the enum, a bad list item', () => {
  assert.deepEqual(schemaProblems({score: 80, tier: 'B', tags: ['a']}, schema), []);
  assert.deepEqual(schemaProblems({score: '80', tier: 'Z', tags: [1]}, schema).length, 3);
  assert.deepEqual(schemaProblems({score: 80}, schema), ['$.tier: missing']);
});

test('spearman and top overlap: the same order is 1, the reverse is -1, a different top set shows', () => {
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [40, 30, 20, 10]) + 1) < 1e-9);
  assert.equal(spearman([1, 2], [1, 2]), null);   // too few pairs to say
  assert.equal(topOverlap({a: 9, b: 8, c: 1}, {a: 9, c: 8, b: 1}, 2), 0.5);
});

test('a run on the mock backend gives a full row: valid, in schema, ranked like the baseline, costed', async () => {
  const results = await evaluate(cases, SMALL, mock(cases));
  const row = summarize(SMALL, results, {k: 3});
  assert.deepEqual([row.cases, row.validJsonPct], [8, 100]);
  assert.equal(row.schemaPct, 100);
  assert.ok(row.spearman >= 0.99 && row.topOverlap === 100, `the mock follows the baseline: ${row.spearman} ${row.topOverlap}`);
  assert.ok(row.tokensIn === 8 * 1500 && row.tokensOut === 8 * 200);
});

test('an answer that is not JSON, or an error from the backend, is a failed row, not a crash', async () => {
  const broken = async () => ({choices: [{message: {content: 'Sorry, here is some text'}}], usage: {prompt_tokens: 10, completion_tokens: 5}});
  const [row] = await evaluate(cases.slice(0, 1), SMALL, broken);
  assert.deepEqual([row.valid, row.schemaOk], [false, false]);
  const [down] = await evaluate(cases.slice(0, 1), SMALL, async () => { throw new Error('Workers AI 503'); });
  assert.match(down.error, /503/);
});

test('the table has one row per model with the rank columns, and says n/a without a baseline', () => {
  const rows = [summarize(SMALL, await0(), {k: 3}), summarize(STRONG, [], {k: 3})];
  const text = table(rows, {[SMALL]: 0.0123});
  assert.match(text, /\| @cf\/qwen\/qwen3-30b-a3b-fp8 \| 1 \|/);
  assert.match(text, /\$0\.0123/);
  assert.match(text, /n\/a/);
  function await0() { return [{id: 'x', valid: true, schemaOk: true, score: 50, baseline: undefined, usage: {}, ms: 5}]; }
});

test('--effort asks for that reasoning level; without it the body has none (each model\'s own default)', async () => {
  const bodies = [];
  const fetcher = async (url, init) => { bodies.push(JSON.parse(init.body)); return Response.json({choices: []}); };
  await rest({account: 'a', token: 't', fetcher})(SMALL, {messages: []});
  await rest({account: 'a', token: 't', effort: 'low', fetcher})(SMALL, {messages: []});
  assert.equal('reasoning_effort' in bodies[0], false);
  assert.equal(bodies[1].reasoning_effort, 'low');
});

test('the REST backend posts the model and the Anthropic-translated input to the account\'s chat route with the bearer token', async () => {
  const seen = [];
  const run = rest({account: 'acc1', token: 'tok', fetcher: async (url, init) => { seen.push({url, init}); return Response.json({choices: []}); }});
  await run(SMALL, {messages: [{role: 'user', content: 'hi'}]});
  assert.equal(seen[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc1/ai/v1/chat/completions');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
  assert.equal(JSON.parse(seen[0].init.body).model, SMALL);
  const failing = rest({account: 'a', token: 't', fetcher: async () => new Response('no', {status: 401})});
  await assert.rejects(failing(SMALL, {}), /401/);
});

// Answer cases (a form's fields): each field has what a right answer looks like, and the table counts the cases where every field is right.
const expect = {sex: {empty: true, category: 'demographic'}, country: {value: ['Switzerland']}, consent: {empty: true, category: 'legal'}, notice: {value: ['2 months', '2 Monate']}};
const good = {answers: [{field: 'country', value: 'Switzerland', category: 'knockout'}, {field: 'consent', value: '', category: 'legal'}, {field: 'notice', value: '2 months', category: 'normal'}, {field: 'sex', value: '', category: 'demographic'}]};

test('answerProblems names each field that breaks its expectation: a wrong value, a guessed legal answer, a wrong category, a missing answer', async () => {
  const {answerProblems} = await import('../../tools/free-ai-eval-metrics.mjs');
  assert.deepEqual(answerProblems(good, expect), []);
  const bad = {answers: [{field: 'country', value: 'Germany', category: 'knockout'}, {field: 'consent', value: 'yes', category: 'legal'}, {field: 'sex', value: '', category: 'normal'}]};
  assert.deepEqual(answerProblems(bad, expect), ['sex: category normal, wanted demographic', 'country: "Germany", wanted Switzerland', 'consent: answered, wanted empty', 'notice: no answer']);
  assert.deepEqual(answerProblems({answers: [{field: 'pay', value: 'CHF 135,000'}]}, {pay: {match: '13\\d'}}), []);
  assert.deepEqual(answerProblems({answers: [{field: 'pay', value: 'a lot'}]}, {pay: {match: '13\\d'}}), ['pay: "a lot", wanted /13\\d/']);
  assert.deepEqual(answerProblems({answers: [{field: 'consent', value: '', category: 'legal'}, {field: 'sex', value: ''}]}, {consent: {empty: true}, sex: {empty: true}}), [], 'a field left out counts as empty where empty is wanted');
});

test('the table counts a case right only when every field is right, and the mock run reports it', async () => {
  const {summarize: sum, table: render} = await import('../../tools/free-ai-eval-metrics.mjs');
  const row = sum('m', [{id: 'a', valid: true, schemaOk: true, right: true, usage: {}}, {id: 'b', valid: true, schemaOk: true, right: false, usage: {}}, {id: 'c', valid: false, schemaOk: false, right: false, usage: {}}]);
  assert.equal(row.rightPct, 33);
  assert.match(render([row]), /Right answers/);
  const none = sum('m', [{id: 'a', valid: true, schemaOk: true, score: 5, baseline: 5, usage: {}}]);
  assert.equal(none.rightPct, null, 'score cases have no right-answer column');
});

// Extraction cases (a posting's facts): expect = {paths: {'work_mode.value': [allowed...]}, has: {languages: [{language, level}]}}.
test('factProblems checks values at a path and that a list holds the wanted entries', async () => {
  const {factProblems} = await import('../../tools/free-ai-eval-metrics.mjs');
  const data = {work_mode: {value: 'hybrid'}, salary: {stated: true}, languages: [{language: 'French', level: 'required', evidence: 'x'}, {language: 'English', level: 'nice_to_have'}]};
  assert.deepEqual(factProblems(data, {paths: {'work_mode.value': ['hybrid', 'onsite'], 'salary.stated': [true]}, has: {languages: [{language: 'French', level: 'required'}]}}), []);
  assert.deepEqual(factProblems(data, {paths: {'work_mode.value': ['remote'], 'seniority.value': ['senior']}, has: {languages: [{language: 'German', level: 'required'}]}}),
    ['work_mode.value: "hybrid", wanted remote', 'seniority.value: missing', 'languages: no entry like {"language":"German","level":"required"}']);
});

// Kit cases (CV highlights, cover letter): no single right text, so the checks are the ones that can be verified.
test('kitProblems checks eligibility, the highlight count, a letter, and that no number or money figure is invented', async () => {
  const {kitProblems} = await import('../../tools/free-ai-eval-metrics.mjs');
  const ground = 'Alex has 8 years on Kubernetes. The role pays CHF 150-175k.';
  const kit = {eligible: true, eligibility_note: '', cover_letter: 'I bring 8 years of Kubernetes. CHF 150k suits me.', highlights: ['a', 'b', 'c']};
  assert.deepEqual(kitProblems(kit, {eligible: true}, ground), []);
  assert.deepEqual(kitProblems({...kit, eligible: false, cover_letter: '', highlights: ['a']}, {eligible: true}, ground),
    ['eligible: false, wanted true', 'cover_letter: empty', 'highlights: 1, wanted 3-5']);
  const invented = kitProblems({...kit, cover_letter: 'I led 12 engineers for 15 years.'}, {eligible: true}, ground);
  assert.equal(invented.length, 2);
  assert.match(invented[0], /^cover_letter: invented figure 12 \("I led 12 engineers/); assert.match(invented[1], /^cover_letter: invented figure 15 \(".*for 15 years/);
  assert.deepEqual(kitProblems({...kit, eligibility_note: 'x'}, {eligible: true}, ground), ['eligibility_note: set although eligible']);
});

// 16 Oct 2026: the eval's REST calls drew on the same 10,000 free neurons a day as the production Free AI, and a day of tuning left every user at "busy today".
test('the eval refuses the production Cloudflare account unless --allow-production comes with a call cap', async () => {
  const {guardAccount, PRODUCTION_ACCOUNTS} = await import('../../tools/free-ai-eval.mjs');
  const prod = PRODUCTION_ACCOUNTS[0];
  assert.throws(() => guardAccount({}), /--account/);
  assert.throws(() => guardAccount({account: prod}), /production/);
  assert.equal(guardAccount({account: '0123456789abcdef0123456789abcdef'}).account, '0123456789abcdef0123456789abcdef');
  assert.throws(() => guardAccount({'allow-production': true}), /--max-calls/, 'a production run needs a hard cap');
  assert.throws(() => guardAccount({'allow-production': true, 'max-calls': '0'}), /--max-calls/);
  assert.deepEqual(guardAccount({'allow-production': true, 'max-calls': '100'}), {account: prod, maxCalls: 100, production: true});
});

test('a run that would make more calls than the cap is refused before the first call', async () => {
  const {guardCalls} = await import('../../tools/free-ai-eval.mjs');
  assert.doesNotThrow(() => guardCalls(16, 2, 100));
  assert.throws(() => guardCalls(60, 2, 100), /120 calls.*100/);
  assert.doesNotThrow(() => guardCalls(500, 2, undefined), 'no cap on a separate account');
});

test('the closing line says how many calls were made and what they cost', async () => {
  const {closing} = await import('../../tools/free-ai-eval.mjs');
  assert.match(closing(32, 0.0123, true), /32 calls.*\$0\.0123.*production/);
  assert.match(closing(32, 0.0123, false), /32 calls/);
});

test('failureLines names, per case, why it was not right: the error, or each problem found in the reply', async () => {
  const {failureLines} = await import('../../tools/free-ai-eval.mjs');
  const lines = failureLines('m', [{id: 'a', right: true}, {id: 'b', right: false, problems: ['highlights: 6, wanted 3-5', 'cover_letter: invented figure 12']}, {id: 'c', error: 'timeout'}, {id: 'd', valid: true, score: 5}]);
  assert.deepEqual(lines, ['m b: highlights: 6, wanted 3-5; cover_letter: invented figure 12', 'm c: timeout']);
});

test('answerProblems checks use when a case wants it: two saved facts that disagree are proposed, never typed', async () => {
  const {answerProblems} = await import('../../tools/free-ai-eval-metrics.mjs');
  const want = {notice: {value: ['2 months', '3 months'], use: 'propose'}};
  assert.deepEqual(answerProblems({answers: [{field: 'notice', value: '3 months', use: 'propose'}]}, want), []);
  assert.deepEqual(answerProblems({answers: [{field: 'notice', value: '2 months', use: 'fill'}]}, want), ['notice: use fill, wanted propose']);
});

// The class: an eval case whose expected answer drifted from the demo data it is built from (16 -> 17 Oct 2026: gender-decline and notice kept old answers).
test('every form case\'s expected answer rests on lines the demo profile or answers still say', async () => {
  const fs = await import('node:fs');
  const {FORMS} = await import('../../tools/free-ai-form-list.mjs');
  const {APPLICANTS} = await import('../../tools/free-ai-form-applicants.mjs');
  const demoText = ['profile.md', 'answers.md'].map(name => fs.readFileSync(new URL(`../demo/${name}`, import.meta.url), 'utf8')).join('\n');
  for (const form of FORMS) {
    // A case with its own applicant (tools/free-ai-form-applicants.mjs) rests on that applicant's lines, never the demo's.
    if (form.applicant) assert.ok(APPLICANTS[form.applicant], `${form.id}: no applicant "${form.applicant}" in tools/free-ai-form-applicants.mjs`);
    const demo = form.applicant ? [APPLICANTS[form.applicant].profile, APPLICANTS[form.applicant].answers].join('\n') : demoText;
    // Consent is an AI meaning returned as a gated kind, never an applicant fact or an ordinary typed answer.
    const typed = Object.values(form.expect).some(want => want.category !== 'consent' && want.value && !(want.value.length === 1 && /decline|prefer not|do not wish/i.test(want.value[0])) && !want.empty);
    if (typed) assert.ok(form.rests?.length, `${form.id}: expects a saved answer; name the demo lines it rests on (rests)`);
    for (const line of form.rests || []) assert.ok(demo.includes(line), `${form.id}: the demo no longer says "${line}"; update the case's expected answer`);
  }
});

test('a written answer is matched on what is typed: its "• Add:" reminders are shown beside the box, never typed (#2198)', async () => {
  const {answerProblems} = await import('../../tools/free-ai-eval-metrics.mjs');
  const want = {backlog: {category: 'written', match: 'backlog'}};
  assert.deepEqual(answerProblems({answers: [{field: 'backlog', category: 'written', value: 'I cut backlog noise by half.\n• Add: which teams'}]}, want), []);
  assert.equal(answerProblems({answers: [{field: 'backlog', category: 'written', value: 'I ran 400 services on EKS.\n• Add: a backlog cleanup you led'}]}, want).length, 1, 'the subject only in a reminder is not answered');
});

test('answerProblems flags a written answer that says what a case forbids, after the subject is named (benchmark run 40451005110)', async () => {
  const {answerProblems} = await import('../../tools/free-ai-eval-metrics.mjs');
  const want = {backlog: {category: 'written', match: 'backlog', notMatch: 'so I know how'}};
  assert.deepEqual(answerProblems({answers: [{field: 'backlog', category: 'written', value: 'The closest I can point to for backlog cleanliness is the platform I built.'}]}, want), []);
  assert.equal(answerProblems({answers: [{field: 'backlog', category: 'written', value: 'The closest I can point to for backlog cleanliness is the platform I built, so I know how to keep teams aligned.'}]}, want).length, 1);
});

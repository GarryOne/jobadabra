// The screenshot review on Free AI (lib/review-free.mjs): three readers and a merge over Workers AI with CI's token, answered in Claude's message shape; a busy
// service is asked again, a failed reader leaves the others counting, a checklist answer becomes findings only with evidence.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FREE_MODEL, MODELS, checksToFindings, freeCost, reviewFree, runModel} from '../lib/review-free.mjs';

const ok = (result, status = 200) => ({ok: status < 400, status, json: async () => (status < 400 ? {success: true, result} : {success: false, errors: [{message: 'busy'}]})});
const checks = (yes = {}) => JSON.stringify({checks: ['contradiction', 'count-mismatch'].map(id => (yes[id] ? {id, answer: 'yes', where: 'header', evidence: yes[id]} : {id, answer: 'no'}))});

// A fake Workers AI: the model from the URL, the answer from `answers[model]` (a function of the request body).
const workers = (answers, seen = []) => async (url, init) => {
  const model = decodeURIComponent(url.split('/ai/run/')[1]), body = JSON.parse(init.body);
  seen.push({model, body, auth: init.headers.authorization});
  return ok({response: answers[model](body), usage: {prompt_tokens: 1000, completion_tokens: 100}});
};
const merging = body => String(body.messages[0].content).startsWith('Several reviewers');

test('runModel asks Cloudflare with CI\'s token, strips thinking, reads both answer shapes and counts its cost', async () => {
  const seen = [];
  const answer = await runModel(MODELS.judge, [{role: 'user', content: 'hi'}], {token: 'cf', account: 'acct', fetchImpl: async (url, init) => { seen.push({url, init}); return ok({response: '<think>hmm</think>{"a":1}', usage: {prompt_tokens: 2000, completion_tokens: 20}}); }});
  assert.equal(seen[0].url, `https://api.cloudflare.com/client/v4/accounts/acct/ai/run/${MODELS.judge}`);
  assert.equal(seen[0].init.headers.authorization, 'Bearer cf');
  assert.deepEqual([answer.ok, answer.text, answer.cut], [true, '{"a":1}', false]);
  assert.equal(answer.usd, freeCost(MODELS.judge, {prompt_tokens: 2000, completion_tokens: 20}));
  const choices = await runModel(MODELS.judge, [], {token: 'cf', account: 'a', fetchImpl: async () => ok({choices: [{message: {content: '{"b":2}'}, finish_reason: 'length'}]})});
  assert.deepEqual([choices.text, choices.cut], ['{"b":2}', true]);
  const parsed = await runModel(MODELS.judge, [], {token: 'cf', account: 'a', fetchImpl: async () => ok({response: {findings: []}})});
  assert.equal(parsed.text, '{"findings":[]}');
  assert.equal((await runModel(MODELS.judge, [], {token: '', account: 'a'})).status, 'no-token');
});

test('runModel asks a busy service twice more, and gives up at once on a refusal', async () => {
  let calls = 0;
  const busy = await runModel(MODELS.judge, [], {token: 'cf', account: 'a', waitMs: 0, fetchImpl: async () => { calls++; return calls < 3 ? ok(null, 429) : ok({response: 'fine'}); }});
  assert.deepEqual([busy.ok, calls], [true, 3]);
  calls = 0;
  const refused = await runModel(MODELS.judge, [], {token: 'cf', account: 'a', waitMs: 0, fetchImpl: async () => { calls++; return ok(null, 403); }});
  assert.deepEqual([refused.ok, refused.status, calls], [false, 403, 1]);
  assert.match(refused.detail, /busy/);
});

test('a checklist answer keeps only the checks answered yes with evidence, in the shapes the models use', () => {
  assert.deepEqual(checksToFindings(checks({contradiction: 'pill says Done, text says Failed'})), [{title: 'contradiction: header', detail: 'pill says Done, text says Failed'}]);
  assert.deepEqual(checksToFindings('{"checks":[{"id":"cut-off","answer":"yes","evidence":"E"}]}'), [], 'too little evidence to quote');
  assert.equal(checksToFindings('{"checks":[{"type":"cut-off","findings":["the chip shows only E…"]}]}').length, 1);
  assert.deepEqual(checksToFindings('not json'), []);
});

test('reviewFree: the checklist, two describe-then-check readers and one merge; the answer in Claude\'s shape, with the cost of every call', async () => {
  const seen = [];
  const answers = {[MODELS.check]: () => checks({contradiction: 'pill says Done, text says Failed'}), [MODELS.describe[0]]: () => 'A header and a pill.', [MODELS.describe[1]]: () => 'A header.',
    [MODELS.judge]: body => (merging(body) ? '{"findings":[{"severity":"high","kind":"wrong-result","title":"Pill and text disagree"}]}' : checks())};
  const result = await reviewFree({view: 'jobs', pngBase64: 'iVBORw0KGgo=', facts: {jobs: 0}, lessons: 'BY DESIGN: the empty rail'}, {token: 'cf', account: 'a', fetchImpl: workers(answers, seen)});
  assert.equal(result.ok, true);
  assert.deepEqual(seen.map(call => call.model).sort(), [MODELS.check, ...MODELS.describe, MODELS.judge, MODELS.judge, MODELS.judge].sort());
  const merge = seen.find(call => call.model === MODELS.judge && merging(call.body));
  assert.match(merge.body.messages[1].content, /Page: jobs[\s\S]*"jobs": 0[\s\S]*pill says Done[\s\S]*BY DESIGN: the empty rail/);
  assert.match(result.message.content[0].text, /Pill and text disagree/);
  assert.equal(result.message.stop_reason, 'end_turn');
  assert.deepEqual(result.message.usage, {input_tokens: 6000, output_tokens: 600});
  assert.ok(Math.abs(result.usd - seen.reduce((sum, call) => sum + freeCost(call.model, {prompt_tokens: 1000, completion_tokens: 100}), 0)) < 1e-12);
  assert.match(FREE_MODEL, /^free-ai:[0-9a-f]{10}$/);
});

test('reviewFree: nothing found asks no merge; a failed reader is named and the others count; all failing or a failed merge is not a review', async () => {
  const none = {[MODELS.check]: () => checks(), [MODELS.describe[0]]: () => 'x', [MODELS.describe[1]]: () => 'y', [MODELS.judge]: () => checks()}, seen = [];
  const quiet = await reviewFree({view: 'jobs', pngBase64: 'x'}, {token: 'cf', account: 'a', fetchImpl: workers(none, seen)});
  assert.deepEqual([quiet.ok, quiet.message.content[0].text, seen.some(call => merging(call.body))], [true, '{"findings":[]}', false]);
  const flaky = async (url, init) => (url.includes(encodeURIComponent(MODELS.describe[1])) || url.endsWith(MODELS.describe[1]) ? ok(null, 403) : workers(none)(url, init));
  const partly = await reviewFree({view: 'jobs', pngBase64: 'x'}, {token: 'cf', account: 'a', waitMs: 0, fetchImpl: flaky});
  assert.equal(partly.ok, true);
  assert.deepEqual(partly.readers.filter(reader => reader.failed).map(reader => reader.name), [`described (${MODELS.describe[1]})`]);
  const down = await reviewFree({view: 'jobs', pngBase64: 'x'}, {token: 'cf', account: 'a', waitMs: 0, fetchImpl: async () => ok(null, 403)});
  assert.equal(down.ok, false); assert.match(down.detail, /every reader failed/);
  const found = {...none, [MODELS.check]: () => checks({contradiction: 'pill says Done, text says Failed'})};
  const noMerge = await reviewFree({view: 'jobs', pngBase64: 'x'}, {token: 'cf', account: 'a', waitMs: 0, fetchImpl: async (url, init) => (merging(JSON.parse(init.body)) ? ok(null, 403) : workers(found)(url, init))});
  assert.equal(noMerge.ok, false); assert.match(noMerge.detail, /the merge failed/);
});

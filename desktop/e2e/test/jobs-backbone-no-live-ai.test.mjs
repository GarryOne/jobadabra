// Prove jobs' captured engine asks use reviewed answers, feed scores and enrichments included, without live AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {answerFor, loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {hash} from '../lib/ai-answers-engine-items.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {modelFetch} from '../lib/model.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`../fixtures/golden/${name}`, import.meta.url), 'utf8'));
const {requests: asks, scorePostings} = read('jobs-asks.json'), {requests: decisions} = read('jobs-decide.json');
const tableFile = fileURLToPath(new URL('../fixtures/golden/ai-answers.json', import.meta.url));
const background = ['organize_lines', 'answer_home', 'contact_asks', 'missing_facts_wording', 'covered_facts',
  'reuse_verdict', 'question_formats', 'contact_from_cv', 'cv_queue'];
const initOf = row => ({method: 'POST', headers: {'content-type': 'application/json', ...(row.action ? {'x-jp-action': row.action} : {})}, body: JSON.stringify(row.body)});
const payload = reply => JSON.parse(reply.content[0].text);
const capturedScores = asks.filter(row => row.expectedId);
// Feed score identity is qu's feed key (#2539): these are the eleven main-run postings, never golden IDs by coincidence.
const scoreFeedPostings = [
  ['Senior Site Reliability Engineer, Payments', 'E2E Acme', 'Zurich, Switzerland'],
  ['Staff Site Reliability Engineer', 'E2E Acme', 'Zurich, ZH, Switzerland'],
  ['Senior Infrastructure Engineer, Kubernetes', 'E2E Acme', 'Zurich, Switzerland'],
  ['Senior Site Reliability Engineer', 'E2E Acme', 'Zurich, ZH, Switzerland'],
  ['Staff Platform Engineer', 'E2E Gamma', 'Zurich, Switzerland'],
  ['Staff Platform Engineer, Observability', 'E2E Acme', 'Zurich, Switzerland'],
  ['Senior Site Reliability Engineer', 'E2E Gamma', 'Zurich, Switzerland'],
  ['Senior DevOps Engineer', 'E2E Gamma', 'Zurich, Switzerland'],
  ['Senior DevOps Engineer, Cloud', 'E2E Acme', 'Zurich, Switzerland'],
  ['Platform Engineer, Kubernetes', 'E2E Acme', 'Zurich, ZH, Switzerland'],
  ['Senior DevOps Engineer', 'E2E Beta', 'Remote - Europe'],
];

function valid(schema, value) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) return types.includes('null');
  if (types.includes('integer')) return Number.isInteger(value);
  if (types.includes('array')) return Array.isArray(value) && value.every(item => valid(schema.items, item));
  if (types.includes('object')) return typeof value === 'object' && !Array.isArray(value) &&
    schema.required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && valid(schema.properties[key], value[key]));
  return types.includes(typeof value);
}

async function atEverySeam(h, row, expected) {
  const init = initOf(row);
  assert.deepEqual(storedAnswer(init, h.env), expected, row.provenance);
  if (expected.refuse) await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
  else assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), expected.reply);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, expected.refuse ? 401 : 200);
  if (expected.reply) assert.deepEqual(await response.json(), expected.reply);
  if (h.openaiProxy) {
    const {system, messages, output_config} = row.body;
    const wire = {model: 'test', instructions: system, input: messages, text: output_config && {format: output_config.format}};
    const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, {...init, body: JSON.stringify(wire)});
    assert.equal(response.status, expected.refuse ? 401 : 200);
    if (expected.reply) assert.deepEqual(JSON.parse((await response.json()).output[0].content[0].text), payload(expected.reply));
  }
}

for (const family of ['claude', 'openai']) test(`jobs answers every keyable captured/reconstructed ask at every seam (${family})`, async t => {
  const h = await backboneHarness(t, 'jobs', family), table = loadTable(tableFile);
  let checked = 0;
  for (const row of [...asks, ...decisions]) {
    const question = questionOf(initOf(row), h.env, table);
    assert.ok(!question.unkeyable, `${row.provenance}: ${question.unkeyable}`);
    const expected = answerFor(question, table);
    assert.ok(expected.reply, `${row.provenance}: ${JSON.stringify(expected)}`);
    if (row.expectedId) assert.equal(question.id, row.expectedId);
    if (row.answers) assert.deepEqual(payload(expected.reply), {results: row.answers.map((answer, index) => ({index, answer}))});
    await atEverySeam(h, row, expected); checked++;
  }
  assert.equal(checked, asks.length + decisions.length, 'every captured and reconstructed ask resolves at every seam, feed scores and enrichments included');
  for (const action of background) {
    const row = {action, body: {model: 'test', messages: [{role: 'user', content: 'background read'}]}};
    await atEverySeam(h, row, table.kinds[action].answer);
  }
  h.assertNoLive();
});

test('jobs feed scores resolve to complete schema-valid authored replies and no captured ask is unkeyable', async t => {
  const h = await backboneHarness(t, 'jobs'), table = loadTable(tableFile);
  assert.deepEqual(capturedScores.map(({posting: p}) => [p.title, p.company, p.location]), scoreFeedPostings);
  for (const row of capturedScores) assert.equal(row.expectedId, `feed/${hash(row.posting)}`, 'canonical sorted object keys; values trimmed');
  assert.equal(scorePostings.length, 40, 'fixed feeds, six seeded matches in four Zurich spellings, and the slow check');
  for (const {id, ...posting} of scorePostings) {
    assert.equal(id, `feed/${hash(posting)}`);
    const stored = answerFor({operation: 'app.score', id}, table);
    assert.ok(stored.reply, `${id} needs a full authored score`);
    const score = payload(stored.reply);
    assert.ok(valid(capturedScores[0].body.output_config.format.schema, score), posting.title);
    assert.ok(score.score >= 0 && score.score <= 100);
    assert.equal(score.basis.salary_stated, false); assert.equal(score.components.compensation, null);
    assert.equal(score.search.career_change, false, 'search_role is not asked for these same-field scores');
    assert.ok(score.strengths.length && score.gaps.length);
  }
  assert.deepEqual(asks.filter(row => questionOf(initOf(row), h.env, table).unkeyable), [], 'qu\'s feed key resolves every captured score and enrich ask');
  h.assertNoLive();
});

// Why (30 Oct 2026, ap): jobs' own CI runs 41055343530 and 41058186185 refused these eleven asks (three place words in the Zurich/Amsterdam search context, eight feed enrichments, full and role-only); each is stored now.
test('every ask jobs\' own CI run refused is stored', () => {
  const table = loadTable(tableFile), refused = read('jobs-missing-keys.json');
  assert.equal(refused.length, 11);
  for (const {family, key} of refused) assert.ok(table.items[family][key], `${family}: ${key}`);
});

test('golden-matching score positive controls keep their existing ids and answers', () => {
  const table = loadTable(tableFile), company = read('sources.json')[0].company;
  for (const row of read('truth.json').filter(row => table.answers['app.score'][row.id])) {
    const body = {messages: [{role: 'user', content: `Title: ${row.title}\nCompany: ${row.company || company}\nLocation: ${row.location}`}]};
    const q = questionOf({headers: {'x-jp-action': 'score'}, body}, {}, table);
    assert.deepEqual(q, {operation: 'app.score', id: String(row.id)});
    assert.deepEqual(answerFor(q, table), table.answers['app.score'][row.id]);
  }
});

test('jobs title answers keep the right roles, reject decoys and place Zurich spellings sensibly', () => {
  const table = loadTable(tableFile), env = {E2E_AI_ANSWERS: 'backbone'};
  let keep = 0, drop = 0;
  for (const row of asks) {
    const q = questionOf(initOf(row), env, table);
    for (const item of q.items || []) {
      const answer = table.items[q.operation]?.[item.key]?.answer;
      assert.notEqual(answer, undefined, `${q.operation}/${item.key}`);
      if (q.operation === 'app.title') {
        const decoy = /intern|account executive|designer|sales development|marketing|recruiter/.test(item.text);
        assert.equal(answer, !decoy, item.text); if (answer) keep++; else drop++;
      }
      if (q.operation === 'app.geo' && /z[uü]rich/.test(item.text)) {
        assert.equal(answer.cc, 'CH'); assert.equal(answer.kind, 'city');
        assert.ok(Math.abs(answer.lat - 47.3769) < 0.1 && Math.abs(answer.lon - 8.5417) < 0.1);
      }
      if (q.operation === 'app.visa') assert.equal(answer, false, 'EU citizen needs no sponsorship in Switzerland/EU');
    }
  }
  assert.ok(keep >= 14 && drop >= 157);
});

test('jobs names an undeclared kind before any cache, engine or transport', async t => {
  const h = await backboneHarness(t, 'jobs');
  const init = initOf({action: 'undeclared_jobs_kind', body: {model: 'test', messages: [{role: 'user', content: 'new ask'}]}});
  const missing = {code: 'E2E_AI_ANSWER_MISSING', message: /jobs: undeclared_jobs_kind.*is unkeyable/};
  assert.throws(() => storedAnswer(init, h.env), missing);
  await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 503); assert.match((await response.json()).error.message, missing.message);
  h.assertNoLive();
});

test('jobs slow proxy counts a stored engine answer before lookup with no live call', async t => {
  const h = await backboneHarness(t, 'jobs'), row = asks.find(row => questionOf(initOf(row), h.env).operation === 'app.title');
  const before = h.proxy.stats.calls, original = fs.readFileSync;
  // Observing table access proves the suite counter already changed, without an eight-second local sleep.
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    if (String(file) === tableFile) assert.ok(h.proxy.stats.calls - before >= 1);
    return original.call(this, file, ...args);
  });
  assert.equal((await h.localFetch(`${h.proxy.url}/v1/messages`, initOf(row))).status, 200);
  assert.equal(h.proxy.stats.calls - before, 1);
  const source = fs.readFileSync(new URL('../suites/jobs.mjs', import.meta.url), 'utf8');
  assert.match(source, /proxy\.setDelay\(8000\)/);
  assert.match(source, /proxy\.stats\.calls - callsBefore < 1/);
  h.assertNoLive();
});

test('jobs declares offline AI, enables the guard and uses backbone on both workflow attempts', () => {
  const source = fs.readFileSync(new URL('../suites/jobs.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  const attempts = [...workflow.matchAll(/E2E_AI_ANSWERS: .*contains\(fromJSON\('([^']+)'\), matrix\.suite\)/g)];
  assert.equal(attempts.length, 2);
  for (const [, suites] of attempts) assert.ok(JSON.parse(suites).includes('jobs'));
});

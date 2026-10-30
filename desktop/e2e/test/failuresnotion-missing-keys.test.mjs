// Replay failuresnotion's two captured CI refusal sets through stored, direct and proxy seams.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {requestParts, valid} from '../lib/ai-answers-engine-items.mjs';
import {answersTableFile, backboneHarness} from '../lib/backbone-harness.mjs';
import {modelFetch} from '../lib/model.mjs';
import {withDerived} from '../../lib/target-roles.js';
import {bodyOf, engineCases} from './ai-answers-engine-fixtures.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
const missing = read('../fixtures/golden/failuresnotion-missing-keys.json');
const second = read('../fixtures/golden/failuresnotion-run2-keys.json');
const enrichSystem = requestParts(read('../fixtures/golden/ai-format-python.json').entries.find(entry => entry.kind === 'app.enrich').request).system;
const demo = withDerived(read('../../demo/draft.json').draft.search);
const placeContext = read('../fixtures/golden/activityfailures-feed-asks.json').place.context;
const roleKind = read('../fixtures/golden/activityfailures-decide.json').requests[0];
const request = (action, body) => ({method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body)});

function requestOf(ask) {
  const roleOnly = ask.family === 'app.enrich' && ask.key.endsWith('/role');
  const text = roleOnly ? ask.what.split(' | ')[0] : ask.what.includes('"') ? JSON.parse(ask.what.slice(ask.what.indexOf('"'))) : ask.what;
  if (ask.family === 'app.decide') {
    const body = structuredClone(roleKind);
    body.messages[0].content = body.messages[0].content.split('### Item 0')[0]
      .replace(' Answer unsure when none of these fits the role well.', '').replace(', unsure\n', '\n') + `### Item 0\n${text}`;
    body.output_config.format.schema.properties.results.items.properties.answer.enum =
      body.output_config.format.schema.properties.results.items.properties.answer.enum.filter(answer => answer !== 'unsure');
    return request('decide', body);
  }
  const c = structuredClone(engineCases.find(c => ask.family === 'app.enrich'
    ? c.name === (roleOnly ? 'enrich role' : 'enrich') : c.operation === ask.family));
  if (ask.family === 'app.title') c.user = `The search (JSON): ${JSON.stringify({role_words: demo.role_keywords, words_ruled_out: demo.title_exclude_keywords})}\nThe titles:\n1. ${text}`;
  if (ask.family === 'app.place') c.user = `Their places (JSON): ${JSON.stringify(placeContext)}\nThe job locations:\n1. ${text}`;
  if (ask.family === 'app.enrich') {
    // Full extraction carries the real sender's generated schema guidance as well as its fixed opening.
    if (!roleOnly) c.system = enrichSystem;
    const location = roleOnly ? ask.what.split(' | ')[2] : text.includes('save seed') ? 'Zurich, Switzerland' : 'Zurich, Switzerland or Amsterdam, Netherlands';
    c.user = `Title: ${text}\nCompany: E2E Acme\nLocation: ${location}\n\nPosting:\n${text}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, hybrid in Zurich, English working language.`;
  }
  return request(c.action, bodyOf(c));
}

// Why (30 Oct 2026, ap): the two zürich metro/country decide rows came with PR #2560 (merged), so all twelve CI refusals now resolve here; none is excluded.
test('declared CI asks are twelve distinct keys, the two zürich ones from PR #2560 included', () => {
  assert.equal(missing.length, 12);
  assert.equal(new Set(missing.map(ask => ask.key)).size, 12);
});

const placeWord = ask => ask.family === 'app.decide' && ask.what === 'item 0 "zürich"';

test('the two zürich place-word decide asks are stored (metro ch-zurich, country ch), as PR #2560 authored them', () => {
  const table = loadTable(answersTableFile);
  for (const ask of missing.filter(placeWord)) {
    const answer = ask.key.includes('/6ddd2461') ? 'ch-zurich' : 'ch';
    assert.deepEqual(table.items['app.decide'][ask.key], {text: 'zürich', answer});
  }
  assert.equal(missing.filter(placeWord).length, 2);
});

// Why (30 Oct 2026, supervisor/Gitar): run 41058466160 needs the same request-key/schema/transport proof as run 1, not key existence alone.
for (const ask of [...missing.filter(ask => !placeWord(ask)), ...second]) test(`${ask.family}: ${ask.key}`, async t => {
  const h = await backboneHarness(t, 'failuresnotion');
  const init = requestOf(ask), question = questionOf(init, h.env);
  assert.equal(question.operation, ask.family);
  assert.deepEqual(question.items.map(item => item.key), [ask.key], 'reconstructed product request must equal the refused key exactly');
  const expected = storedAnswer(init, h.env).reply;
  assert.ok(expected, ask.what);
  const data = JSON.parse(expected.content[0].text), body = JSON.parse(init.body);
  assert.ok(valid(body.output_config.format.schema, data), 'answer satisfies the product schema');
  if (ask.family === 'app.title') assert.deepEqual(data, {fit: [1]});
  if (ask.family === 'app.place') assert.deepEqual(data.locations, [{n: 1, where: 'Zurich', country: 'Switzerland', nearest: 'zürich', km: 0, answer: 'best'}]);
  if (ask.family === 'app.decide') {
    assert.deepEqual(data, {results: [{index: 0, answer: 'software'}]});
    const lower = structuredClone(roleKind);
    lower.messages[0].content = lower.messages[0].content.split('### Item 0')[0] + '### Item 0\nsite reliability engineer';
    assert.deepEqual(JSON.parse(storedAnswer(request('decide', lower), h.env).reply.content[0].text), data,
      'capitalized senior title keeps the stored lowercase role-kind verdict (the newer task also allows unsure)');
  }
  if (ask.family === 'app.enrich') {
    assert.equal(data.role_family, 'sre');
    if (ask.key.endsWith('/role')) assert.deepEqual(data, {role_family: 'sre'});
    else {
      assert.deepEqual(data.technologies, ['Kubernetes', 'AWS', 'Terraform']);
      assert.equal(data.seniority.value, 'senior');
      assert.equal(data.work_mode.value, 'hybrid');
      assert.equal(data.english_is_enough.value, 'yes');
      assert.equal(data.on_call, 'yes');
      assert.deepEqual(data.salary, {stated: false, text: ''});
      assert.equal(data.employer_type.value, 'unknown');
      assert.equal(data.visa_sponsorship.value, 'unknown');
      assert.equal(data.contract, 'unknown');
    }
  }
  assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), expected);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  h.assertNoLive();
});

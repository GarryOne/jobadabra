// The employers suite's checks and its Sonnet judge are only worth anything if they fail on a wrong input: each test feeds a deliberately broken one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {blank, byQuality, duplicates, EXPECTED, parseRunLine, rowProblems} from '../../lib/employers.mjs';
import {buildRequest, judge, parseVerdicts, problems} from '../../lib/judge.mjs';
import {flatten} from '../../lib/notion.mjs';
import {answerFor, loadTable, questionOf, storedAnswer} from '../../lib/ai-answers.mjs';
import {backboneHarness} from '../../lib/backbone-harness.mjs';
import {checkAiMisses} from '../../lib/no-real-ai.mjs';
import {modelFetch} from '../../lib/model.mjs';
import {requestKey} from '../../lib/ai-meter.mjs';
import {valid} from '../../lib/ai-answers-engine-items.mjs';

const good = {name: 'E2E Nimbus', feed_status: 'Feed found', ats: 'greenhouse', slug: 'e2e-nimbus', feed: 'https://x', quality: 76, cities: 'Zurich', relevant_roles: 4,
  in_preferred_places: 4, notes: '5 postings; 4 SRE-type; 4 in preferred places', origin: 'Tier 1 seed', tier: 'Tier 1', checked: '2026-10-02', added: '2026-10-02', active: true};

test('a complete row passes, and each broken one is named', () => {
  assert.deepEqual(rowProblems(good, 'found'), []);
  assert.match(rowProblems({...good, notes: ''}, 'found').join(), /"notes" is empty/);
  assert.match(rowProblems({...good, cities: 'undefined'}, 'found').join(), /"cities" is empty/);
  assert.match(rowProblems({...good, notes: '5 postings; undefined SRE-type'}, 'found').join(), /says/);
  assert.match(rowProblems({...good, quality: 0}, 'found').join(), /outside 1 to 100/);
  assert.match(rowProblems({...good, quality: null}, 'found').join(), /"quality" is empty/);
  assert.match(rowProblems({...good, in_preferred_places: 9}, 'found').join(), /more roles in preferred places/);
  assert.match(rowProblems({...good, slug: null}, 'found').join(), /"slug" is empty/);
});

test('a manual-watch row needs its careers link, a no-feed row only its name and status', () => {
  const quiet = {name: 'E2E Quiet', feed_status: 'Manual watch', careers_url: 'https://quiet.e2e.test/careers', origin: 'Tier 1 seed (no public feed)', tier: 'Tier 1', checked: '2026-10-02'};
  assert.deepEqual(rowProblems(quiet, 'manual'), []);
  assert.match(rowProblems({...quiet, careers_url: null}, 'manual').join(), /"careers_url" is empty/);
  assert.deepEqual(rowProblems({name: 'E2E Ghost', feed_status: 'No public feed', origin: 'Tier 1 seed', tier: 'Tier 1', checked: '2026-10-02'}, 'none'), []);
  assert.match(rowProblems({name: 'E2E Ghost', feed_status: 'No public feed'}, 'none').join(), /"origin" is empty/);
});

test('blank means empty, whitespace or a leaked "undefined"', () => {
  for (const value of [null, undefined, '', '  ', 'undefined', 'NULL', NaN]) assert.equal(blank(value), true, String(value));
  for (const value of ['Zurich', 0, 76, false]) assert.equal(blank(value), false, String(value));
});

test("the run line is read as numbers, and a line that says neither is not guessed at", () => {
  assert.deepEqual(parseRunLine('checked 7 · 🆕 2 new sources'), {checked: 7, added: 2});
  assert.deepEqual(parseRunLine('checked 0 · 🆕 0 new sources'), {checked: 0, added: 0});
  assert.deepEqual(parseRunLine('New employer sources · 7 checked · 2 new sources'), {checked: 7, added: 2});   // the card wording of 5 Oct 2026
  assert.equal(parseRunLine('New employer sources (AI cost $0.003)'), null, 'a headline with no counts says neither');
  assert.deepEqual(parseRunLine('checked 7 · 1 new source'), {checked: 7, added: 1});
  assert.deepEqual(parseRunLine('2 new feeds'), {checked: null, added: 2});
  assert.equal(parseRunLine('Done.'), null);
  assert.equal(parseRunLine(''), null);
  assert.equal(parseRunLine(undefined), null);
});

test('duplicates are found by name, ignoring case; quality orders best first; the expectations cover every kind of candidate', () => {
  assert.deepEqual(duplicates([{name: 'E2E Orbit'}, {name: 'e2e orbit '}, {name: 'E2E Nimbus'}]), ['e2e orbit']);
  assert.deepEqual(duplicates([{name: 'A'}, {name: 'B'}]), []);
  assert.deepEqual(byQuality([{name: 'low', quality: 10}, {name: 'high', quality: 80}]), ['high', 'low']);
  assert.deepEqual([...new Set(Object.values(EXPECTED).map(item => item.status))].sort(), ['duplicate', 'excluded', 'found', 'low', 'manual', 'none']);
});

test('a Notion row is flattened to plain values', () => {
  const row = flatten({id: 'x', properties: {Company: {type: 'title', title: [{plain_text: 'E2E '}, {plain_text: 'Nimbus'}]}, Quality: {type: 'number', number: 76}, Active: {type: 'checkbox', checkbox: true},
    'Feed status': {type: 'select', select: {name: 'Feed found'}}, Notes: {type: 'rich_text', rich_text: []}, Feed: {type: 'url', url: null}, Checked: {type: 'date', date: {start: '2026-10-02'}}}});
  assert.deepEqual(row, {_id: 'x', Company: 'E2E Nimbus', Quality: 76, Active: true, 'Feed status': 'Feed found', Notes: '', Feed: null, Checked: '2026-10-02'});
});

test('the judge: a request without temperature, a verdict only in the fixed shape, and a rejection or silence is never a pass', () => {
  const request = buildRequest({person: 'an SRE in Zurich', items: [{name: 'A'}]});
  assert.equal(request.model, process.env.E2E_JUDGE_MODEL || 'claude-haiku-5-5', 'Haiku unless a suite asks (7 Oct 2026, "$30 a week")');
  assert.ok(!('temperature' in request));
  assert.match(request.messages[0].content, /SRE in Zurich[\s\S]*"name": "A"/);
  const verdicts = parseVerdicts('ok: ' + JSON.stringify({items: [{name: 'A', makes_sense: true, reason: 'fits'}, {name: 'B', makes_sense: 'yes'}, {makes_sense: false}, null, {name: 'C', makes_sense: false, reason: 'sales roles in Berlin'}]}));
  assert.deepEqual(verdicts.map(item => item.name), ['A', 'C']);
  assert.deepEqual(parseVerdicts('no json'), []);
  assert.deepEqual(problems(['A'], verdicts), []);
  assert.match(problems(['C'], verdicts).join(), /sales roles in Berlin/);
  assert.match(problems(['B'], verdicts).join(), /no verdict on B/);
  assert.match(problems(['A'], []).join(), /no verdict/);
});

test('the judge call fails loudly when the request is rejected', async () => {
  const rejected = async () => ({ok: false, status: 400, json: async () => ({error: {message: '`temperature` is deprecated for this model'}})});
  await assert.rejects(judge({key: 'k', person: 'p', items: [], fetchImpl: rejected}), /rejected \(400\).*temperature/);
  const answered = async () => ({ok: true, status: 200, json: async () => ({content: [{type: 'text', text: '{"items":[{"name":"A","makes_sense":false,"reason":"wrong city"}]}'}]})});
  assert.deepEqual(await judge({key: 'k', person: 'p', items: [], fetchImpl: answered}), [{name: 'A', makes_sense: false, reason: 'wrong city'}]);
});

const fixture = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/employers-asks.json', import.meta.url)));
const request = ask => ({method: 'POST', headers: {'content-type': 'application/json', ...(ask.action ? {'x-jp-action': ask.action} : {})}, body: JSON.stringify(ask.body)});
const dataOf = reply => JSON.parse(reply.content[0].text);

for (const family of ['claude', 'openai']) test(`employers captured and reconstructed asks resolve at stored, direct and ${family} proxy seams with cache off`, async t => {
  const h = await backboneHarness(t, 'employers', family);
  Object.assign(h.env, {E2E_AI_REPLAY: '0', E2E_AI_CACHE: ''});
  Object.assign(process.env, h.env);
  t.after(() => h.assertNoLive());
  const table = loadTable(), keys = new Set();
  for (const ask of fixture.asks) {
    const init = request(ask), question = questionOf(init, h.env, table);
    assert.ok(question.operation, JSON.stringify(question));
    const identified = (question.items?.map(item => item.key) || [question.id]).map(key => `${question.operation}/${key}`);
    assert.deepEqual(identified, ask.keys, ask.source);
    for (const key of identified) keys.add(key);
    const expected = storedAnswer(init, h.env).reply;
    assert.ok(expected, ask.source);
    if (ask.body.output_config) assert.ok(valid(ask.body.output_config.format.schema, dataOf(expected)), ask.source);
    assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), expected);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 200, ask.source);
    assert.deepEqual(await response.json(), expected);
    if (family === 'openai') {
      const body = {model: 'test', instructions: ask.body.system, input: ask.body.messages,
        ...(ask.body.output_config ? {text: {format: ask.body.output_config.format}} : {}), prompt_cache_key: `job-pilotto-${ask.action}`};
      const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, {...init, body: JSON.stringify(body)});
      assert.equal(response.status, 200, ask.source);
      assert.deepEqual(JSON.parse((await response.json()).output[0].content[0].text), dataOf(expected));
    }
  }
  assert.equal(checkAiMisses(h.env.E2E_ARTIFACTS, {aiMissesMax: 0}).misses, 0);
  console.log(`AI asks with no stored answer: 0; ${keys.size} distinct questions; cache off; live transports 0`);
  console.log([...keys].sort().join('\n'));
});

test('both CI-refused organizer asks keep their kind identity despite changing UUIDs', () => {
  const captured = fixture.asks.filter(ask => ask.action === 'organize_lines');
  assert.equal(captured.length, 2);
  assert.equal(new Set(captured.map(ask => requestKey('/v1/messages', Buffer.from(JSON.stringify(ask.body))))).size, 2);
  for (const ask of captured) {
    const q = questionOf(request(ask), {E2E_AI_ANSWERS: 'backbone'});
    assert.deepEqual(q, {operation: 'app.kind', id: 'organize_lines'});
    assert.deepEqual(dataOf(answerFor(q, loadTable()).reply), {items: []});
  }
});

test('stored board judgments preserve Nimbus and Orbit counts and reject the noise board', () => {
  const table = loadTable(), env = {E2E_AI_ANSWERS: 'backbone'};
  const titleAsk = fixture.asks.find(ask => ask.source.includes('job-title-kind'));
  const titleQuestion = questionOf(request(titleAsk), env, table);
  const kinds = new Map(titleQuestion.items.map(item => [item.text, table.items['app.decide'][item.key].answer]));
  const placeAsk = fixture.asks.find(ask => ask.action === 'place_triage');
  const placeQuestion = questionOf(request(placeAsk), env, table);
  const locations = new Map(placeQuestion.items.map(item => [item.text, table.items['app.place'][item.key].answer.answer]));
  for (const [board, company, expected] of [['nimbus', 'E2E Nimbus', [4, 4]], ['orbit', 'E2E Orbit', [2, 1]], ['noise', 'E2E Noise', [0, 0]]]) {
    const {jobs} = JSON.parse(fs.readFileSync(new URL(`../../fixtures/feeds/employers/${board}.json`, import.meta.url)));
    const matching = jobs.filter(job => kinds.get(job.title) === 'software');
    const preferred = matching.filter(job => ['best', 'inside'].includes(locations.get(job.location.name.toLowerCase())));
    assert.deepEqual([matching.length, preferred.length], expected, company);
    assert.equal(EXPECTED[company].status, preferred.length ? 'found' : 'low');
    assert.equal(EXPECTED[company].active, preferred.length > 0);
  }
  const review = fixture.asks.find(ask => ask.keys[0].startsWith('judge.review/')), {items} = dataOf(storedAnswer(request(review), env).reply);
  assert.deepEqual(items.map(item => item.name).sort(), ['E2E Nimbus', 'E2E Orbit']);
  assert.deepEqual(problems(['E2E Nimbus', 'E2E Orbit'], items), []);
});

test('review identity keeps every fact and person, ignores row/JSON order, and refuses malformed rows', () => {
  const ask = fixture.asks.find(ask => ask.keys[0].startsWith('judge.review/')), env = {E2E_AI_ANSWERS: 'backbone'}, table = loadTable();
  const original = questionOf(request(ask), env, table);
  assert.equal(original.operation, 'judge.review');
  const [person, rows] = ask.body.messages[0].content.slice('The person: '.length).split('\n\nThe items the tool wrote:\n');
  const changed = (p, items) => request({action: '', body: buildRequest({person: p, items})});
  const items = JSON.parse(rows);
  assert.deepEqual(questionOf(changed(person, items.toReversed()), env, table), original);
  for (const init of [changed(`${person} Different candidate.`, items), changed(person, [{...items[0], relevantRoles: 0}, items[1]])]) {
    const question = questionOf(init, env, table);
    assert.notEqual(question.id, original.id);
    assert.equal(answerFor(question, table).missing, `judge.review/${question.id}`);
  }
  assert.match(questionOf(changed(person, [{quality: 86}]), env, table).unkeyable, /judge.review/);
});

test('employers unknown kinds refuse by name at all three seams', async t => {
  const h = await backboneHarness(t, 'employers');
  t.after(() => h.assertNoLive());
  const init = request({action: 'undeclared_employers_kind', body: {}});
  const missing = {code: 'E2E_AI_ANSWER_MISSING', message: /employers: undeclared_employers_kind.*is unkeyable/};
  assert.throws(() => storedAnswer(init, h.env), missing);
  await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 503);
  const {error} = await response.json();
  assert.equal(error.code, missing.code); assert.match(error.message, missing.message);
});

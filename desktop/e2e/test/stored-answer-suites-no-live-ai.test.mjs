// Prove each stored-answer suite below answers its setup asks from the stored table or a named refusal, and that an unknown ask never reaches live AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {FAILURES, OPENAI_FAILURES} from '../lib/ai-proxy.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {modelFetch} from '../lib/model.mjs';
import {valid} from '../lib/ai-answers-engine-items.mjs';

// interactions: isSafe excludes commands, wands and AI-spending controls, so only the shared setup/background reads below are expected.
// Shared ensureSetUp saves the applicant strategy and reloads Focus: role/place decide,
// profile organization, list meanings and the missing-fact/reuse queue are background reads.
const captured = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/activityfailures-decide.json', import.meta.url), 'utf8'));
const refused = ['contact_asks', 'covered_facts', 'reuse_verdict', 'field_redraft', 'missing_facts_wording', 'question_formats', 'places'];
const empty = {answer_home: {items: []}, organize_lines: {items: []}, list_meanings: {lists: []},
  // Why (30 Oct 2026, bb 3/9): the Profile's two header-named reads that interactions reaches; an authored empty read keeps the chips and rows as typed.
  preferences_parse: {countries: [], cities: [], remote: 'unknown', languages: [], relocation: {answer: 'unknown', where: ''}, roles: [],
    seniority: {min: 'unknown', max: 'unknown', open_ended: false}, employment: [], notes: [], unparsed: []},
  locations_move: {preferred: [], acceptable: [], relocation: 'unspecified', destinations: []}};
const table = loadTable(new URL('../fixtures/golden/ai-answers.json', import.meta.url));
const request = (action, body = {model: 'test', messages: [{role: 'user', content: 'Setup background read'}]}) => ({
  method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body),
});

// Why (31 Oct 2026, owner saved gates): interactions, failureschannels, activity and qualityai share setup reads, so all four use the same stored-answer and no-live guards.
for (const suite of ['interactions', 'failureschannels', 'activity', 'qualityai']) {
  for (const family of ['claude', 'openai']) test(`${suite} setup answers and named refusals stop before live ${family} AI`, async t => {
    const h = await backboneHarness(t, suite, family);
    t.after(() => h.assertNoLive());
    for (const kind of [...refused, ...Object.keys(empty)]) {
      const init = request(kind);
      assert.deepEqual(questionOf(init, h.env, table), {operation: 'app.kind', id: kind});
      const found = storedAnswer(init, h.env);
      if (refused.includes(kind)) {
        assert.deepEqual(found, {refuse: 'invalid-key'});
        await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
      } else {
        assert.deepEqual(JSON.parse(found.reply.content[0].text), empty[kind]);
        assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), found.reply);
      }
      const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
      const body = family === 'openai' ? {model: 'test', input: 'Setup background read', prompt_cache_key: `job-pilotto-${kind}`} : undefined;
      const response = await h.localFetch(url, request(kind, body));
      assert.equal(response.status, found.refuse ? 401 : 200, kind);
      const data = await response.json();
      if (found.refuse) assert.equal(data.error.type, (family === 'openai' ? OPENAI_FAILURES : FAILURES)['invalid-key'].type);
      else assert.deepEqual(JSON.parse(family === 'openai' ? data.output[0].content[0].text : data.content[0].text), empty[kind]);
    }
  });

  test(`${suite} seeded metro and role decisions retain the existing stored item answers`, async t => {
    const h = await backboneHarness(t, suite);
    t.after(() => h.assertNoLive());
    for (const body of [captured.request, ...captured.requests]) {
      const init = request('decide', body), question = questionOf(init, h.env, table);
      assert.equal(question.operation, 'app.decide');
      assert.ok(question.items.length);
      const expected = {results: question.items.map(item => {
        const row = table.items['app.decide'][item.key];
        assert.equal(row.text, item.text);
        return {index: item.index, answer: row.answer};
      })};
      assert.deepEqual(JSON.parse(storedAnswer(init, h.env).reply.content[0].text), expected);
      assert.deepEqual(JSON.parse((await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json()).content[0].text), expected);
      const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse((await response.json()).content[0].text), expected);
    }
  });

  for (const family of ['claude', 'openai']) test(`${suite} names an undeclared ask before any live ${family} transport`, async t => {
    const h = await backboneHarness(t, suite, family), init = request(`undeclared_${suite}_kind`);
    t.after(() => h.assertNoLive());
    const missing = {code: 'E2E_AI_ANSWER_MISSING', message: new RegExp(`${suite}: undeclared_${suite}_kind.*is unkeyable`)};
    assert.throws(() => storedAnswer(init, h.env), missing);
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
    const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
    const response = await h.localFetch(url, init);
    assert.equal(response.status, 503);
    const {error} = await response.json();
    assert.equal(error.code, missing.code); assert.match(error.message, missing.message);
  });

  test(`${suite} opts into stored answers and the real-AI guard in every workflow`, () => {
    const source = fs.readFileSync(new URL(`../suites/${suite}.mjs`, import.meta.url), 'utf8');
    assert.match(source, /^export const offlineAi = true;/m);
    assert.match(source, /^export const realAi = false;/m);
    // The suite says so itself; plan-run.mjs puts it in matrix.aiAnswers, which both attempts of e2e.yml read.
    assert.match(source, /^export const aiAnswers = 'backbone';/m);
  });
}

for (const family of ['claude', 'openai']) test(`failureschannels opportunity extraction uses its own stored kind before live ${family} AI`, async t => {
  const h = await backboneHarness(t, 'failureschannels', family);
  t.after(() => h.assertNoLive());
  const entry = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/ai-format-manifest.json', import.meta.url), 'utf8')).entries.find(row => row.kind === 'opportunity');
  assert.ok(entry, 'real opportunity sender must be captured offline');
  assert.equal(entry.action, 'opportunity');
  assert.match(entry.request.system, /^You read a message a recruiter or hiring person/);
  const init = request(entry.action, entry.request);
  assert.deepEqual(questionOf(init, h.env, table), {operation: 'app.kind', id: 'opportunity'});
  const found = storedAnswer(init, h.env);
  assert.deepEqual(JSON.parse(found.reply.content[0].text), {
    is_opportunity: true, title: 'DevOps Engineer', company: 'Initech', client: '', location: '', work_mode: '', salary: '', contract: '',
    recruiter_name: '', recruiter_email: 'recruiter@initech-hr.test', recruiter_company: '', in_house: false,
    platform: 'Email', job_url: '', summary: 'Interview invitation for DevOps Engineer at Initech.', owner_agreed: false,
  });
  assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), found.reply);
  const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
  const body = family === 'openai' ? {model: 'test', input: entry.request.messages[0].content, prompt_cache_key: 'job-pilotto-opportunity'} : entry.request;
  const response = await h.localFetch(url, request('opportunity', body));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(JSON.parse(family === 'openai' ? data.output[0].content[0].text : data.content[0].text), JSON.parse(found.reply.content[0].text));
});

// CI refused these organizer bodies although their question meaning was already stored.
test('activity captured UUID organizer asks and weekly report replay before every transport', async t => {
  const h = await backboneHarness(t, 'activity');
  t.after(() => h.assertNoLive());
  const entries = Object.entries(table.requests['app.kind']).filter(([id]) => id.startsWith('activity-organizer/') || id === 'insight');
  assert.equal(entries.length, 3);
  for (const [id, ask] of entries) {
    const init = request(ask.action, ask.body);
    const found = storedAnswer(init, h.env);
    assert.deepEqual(questionOf(init, h.env, table), {operation: 'app.kind', id: ask.action});
    assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), found.reply);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 200, id); assert.deepEqual(await response.json(), found.reply);
    const data = JSON.parse(found.reply.content[0].text);
    if (id === 'insight') {
      assert.ok(valid(ask.body.output_config.format.schema, data));
      assert.match(data.headline, /0 jobs, 0 applications/);
      assert.deepEqual(data.issues, []);
      assert.ok(data.summary.length > 20);
    } else assert.deepEqual(data, {items: []}, 'preserve the seeded applicant lines');
  }
});

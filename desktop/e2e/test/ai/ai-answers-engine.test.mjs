// Every engine question family must serve or refuse through the same three answer seams without live calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {test} from 'node:test';
import {engineCases, askOf, bodyOf, fixturePortals, recorded, tempTable} from '../ai-answers-engine-fixtures.mjs';
import {message, responseOf, startAiProxy, streamOf} from '../../lib/ai-proxy.mjs';
import {answerFor, keepCandidateBody, loadTable, questionOf, refusedQuestions, storedAnswer} from '../../lib/ai-answers.mjs';
import {modelFetch} from '../../lib/model.mjs';
import {assertNoRealAi, runAiGuards} from '../../lib/no-real-ai.mjs';
import {keep, requestKey} from '../../lib/ai-meter.mjs';

for (const c of engineCases) for (const shape of ['anthropic', 'openai']) test(`${c.name} ${shape}: missing item refuses by name; stored item serves at every seam; zero transports`, async t => {
  const {table} = recorded(t, c), {dir, file, env} = tempTable(t);
  const saved = {...process.env}; Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  let live = 0, engines = 0, relays = 0;
  const upstream = http.createServer((_req, res) => { live++; res.writeHead(500); res.end('forbidden live call'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); return new Promise(resolve => upstream.close(resolve)); });
  const url = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = await startAiProxy({target: url, shape, relay: () => { relays++; throw new Error('must not relay'); }});
  t.after(() => proxy.close());
  // Omit the header: the fixed SYSTEM/schema/user shape must carry identity on both providers.
  const body = bodyOf(c, shape), pathname = shape === 'openai' ? '/v1/responses' : '/v1/messages';
  const init = {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)};
  const ask = {url: pathname, body};
  const options = {env, engine: () => { engines++; throw new Error('must not choose engine'); }};
  keep(requestKey(pathname, Buffer.from(init.body)), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(message('warm cache must not answer')))}, env);
  const named = error => { assert.equal(error.code, 'E2E_AI_ANSWER_MISSING'); assert.ok(error.message.includes(c.operation)); assert.ok(error.message.includes(c.first)); return true; };
  assert.throws(() => storedAnswer(ask, env), named);
  await assert.rejects(modelFetch(`${url}${pathname}`, init, options), named);
  const refused = await fetch(`${proxy.url}${pathname}`, init);
  assert.equal(refused.status, 503); named((await refused.json()).error);
  assert.equal(refusedQuestions(env).length, 3);
  fs.writeFileSync(file, JSON.stringify(table));
  assert.deepEqual(JSON.parse(storedAnswer(ask, env).reply.content[0].text), c.reply);
  assert.deepEqual(JSON.parse((await (await modelFetch(`${url}${pathname}`, init, options)).json()).content[0].text), c.reply);
  const replay = await fetch(`${proxy.url}${pathname}`, init);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), shape === 'openai' ? responseOf(JSON.stringify(c.reply)) : message(JSON.stringify(c.reply)));
  const ctx = {ARTIFACTS: dir, proxy};
  await runAiGuards({realAi: false}, ctx, async (_name, check) => check()); assertNoRealAi(ctx);
  assert.equal(live, 0); assert.equal(engines, 0); assert.equal(relays, 0); assert.equal(proxy.stats.paid || 0, 0);
});

test('places user marker wins even if an action-name dispatcher could otherwise select a generic desktop kind', () => {
  const c = engineCases.find(c => c.name === 'places');
  for (const label of ['scout', 'places', 'anything-else']) assert.equal(questionOf({...askOf(c), headers: {'x-jp-action': label}}, {}).operation, 'app.places');
});

test('print distinct golden domains without asserting future record-run row counts', () => {
  const truth = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/truth.json', import.meta.url)));
  const postings = truth.filter(row => !row.duplicateOf), locations = [...new Set(postings.map(row => row.location.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 120)))].sort();
  const titles = [...new Set(postings.map(row => row.title.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 160)))].sort();
  const sites = [...new Set(Object.values(fixturePortals).map(site => site.name))].sort();
  console.log(`Golden domains: ${locations.length} locations ${JSON.stringify(locations)}; ${titles.length} titles ${JSON.stringify(titles)}; ${postings.length} posting identities; one golden employer board. Visit relevance has ${sites.length} standard portal site identities ${JSON.stringify(sites)}; actual asked subsets depend on earlier answers. Search places: zurich, geneva, switzerland, basel, bern.`);
});

for (const c of engineCases.filter(c => !['score', 'decide', 'place'].includes(c.name))) test(`${c.name}: completed record streams produce loadable per-item review candidates`, t => {
  const {dir} = tempTable(t), q = questionOf(askOf(c), {});
  keepCandidateBody({mode: 'record', question: q, dir}, streamOf(JSON.stringify(c.reply)));
  const items = {};
  for (const name of fs.readdirSync(dir).filter(name => name.startsWith('ai-answers-item-'))) {
    const table = loadTable(`${dir}/${name}`);
    for (const [operation, rows] of Object.entries(table.items)) Object.assign(items[operation] ??= {}, rows);
  }
  assert.equal(Object.keys(items[c.operation]).length, q.items.length);
  assert.deepEqual(JSON.parse(answerFor(q, {answers: {}, items}).reply.content[0].text), c.reply);
});

test('all twelve engine kinds precede declared-kind dispatch; desktop declarations retain backbone-only behavior', () => {
  const operations = [...new Set(engineCases.map(c => c.operation))].sort();
  assert.deepEqual(operations, ['app.decide', 'app.enrich', 'app.geo', 'app.place', 'app.placeReading', 'app.placeVague', 'app.places', 'app.score', 'app.title', 'app.visa', 'app.visit', 'mail'].sort());
  const table = loadTable(), env = {E2E_AI_ANSWERS: 'backbone', E2E_QUALITY_PERSONA: ''};
  for (const c of engineCases) for (const shape of ['anthropic', 'openai']) {
    const declared = {...table, kinds: {...table.kinds, [c.action]: {answer: {refuse: 'invalid-key'}}}};
    assert.equal(questionOf(askOf(c, bodyOf(c, shape)), env, declared).operation, c.operation, `${c.name}: ${shape} must beat the declared ${c.action} refusal`);
  }
  const places = engineCases.find(c => c.name === 'places');
  for (const action of ['scout', 'places']) {
    const declared = {...table, kinds: {...table.kinds, [action]: {answer: {refuse: 'invalid-key'}}}};
    assert.equal(questionOf({...askOf(places), headers: {'x-jp-action': action}}, env, declared).operation, 'app.places');
  }
  for (const [action, entry] of Object.entries(table.kinds)) {
    // Why (30 Oct 2026, qu): interview reviews use the real builder's caption/notes layout (src/ai/interviews_ai.py), not a kind-only contact request.
    const captioned = entry.identity === 'caption', caption = 'recruiter-call-gamma';
    const expected = captioned ? {operation: `app.${action}`, id: caption} : {operation: 'app.kind', id: action};
    const content = captioned ? `Applications:\n(none)\n\nCaption: ${caption}\n\nTranscript or notes:\nFixture interview notes.` : 'Contact question: notice period';
    const request = {headers: {'x-jp-action': action}, body: {model: 'test', system: 'Declared desktop question.', messages: [{role: 'user', content}]}};
    const question = questionOf(request, env, table);
    assert.deepEqual(question, expected);
    assert.deepEqual(answerFor(question, table), captioned ? table.answers[expected.operation][caption] : entry.answer);
    for (const mode of ['off', 'record']) assert.ok(questionOf(request, {...env, E2E_AI_ANSWERS: mode}, table).unkeyable, `${action} must keep its ${mode} path`);
  }
});

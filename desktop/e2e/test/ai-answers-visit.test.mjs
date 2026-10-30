// Engine answer identities, validation and recording for the visit question family.
import {askOf, bodyOf, familyTests, goldenPortalCases, tempTable} from './ai-answers-engine-fixtures.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {test} from 'node:test';
import {answerFor, loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {modelFetch} from '../lib/model.mjs';
familyTests(["visit"]);

import {contextCase} from './ai-answers-engine-fixtures.mjs';
contextCase('visit', body => { body.system[0].text = body.system[0].text.replace('When unsure, keep it.', 'When unsure, leave it out.'); });
contextCase('visit', body => { body.messages[0].content = body.messages[0].content.replace('fixture list', 'another list'); });

const linkedInKey = 'default/app.visit/3c31a9decd99/8da5b7df15fdf99e631ebd98ba5b05b4c74748b6c8fdf318cf01854858b0da13';

test('all authored golden portal variants validate and the captured LinkedIn identity matches the burn-in refusal', () => {
  const table = loadTable();
  const questions = goldenPortalCases().map(c => questionOf(askOf(c), {}));
  assert.equal(questions[0].items[0].key, linkedInKey);
  for (const q of questions) {
    assert.equal(q.items.length, 4);
    for (const item of q.items) assert.deepEqual(table.items['app.visit']?.[item.key], {text: item.text, answer: true});
    assert.deepEqual(JSON.parse(answerFor(q, table).reply.content[0].text), {keep: [1, 2, 3, 4]});
  }
});

test('the authored LinkedIn reply serves at every seam while an unrecorded portal still refuses by name', async t => {
  const {file, env} = tempTable(t);
  fs.writeFileSync(file, JSON.stringify(loadTable()));
  const saved = {...process.env}; Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  let live = 0;
  const upstream = http.createServer((_req, res) => { live++; res.writeHead(500); res.end('forbidden live call'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); return new Promise(resolve => upstream.close(resolve)); });
  const url = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = await startAiProxy({target: url, relay: () => assert.fail('must not relay')});
  t.after(() => proxy.close());
  const c = goldenPortalCases()[0], prefix = c.user.slice(0, c.user.indexOf('The sites:\n') + 'The sites:\n'.length);
  const cases = [
    {...c, user: prefix + `1. ${c.sites[0].name} (${c.sites[0].url}) [portal]`},
    {...c, user: prefix + '1. E2E Unrecorded Portal (https://unrecorded.e2e.test/jobs) [portal]'},
  ];
  for (const [index, item] of cases.entries()) {
    const body = bodyOf(item), ask = askOf(item, body);
    const init = {method: 'POST', headers: {'content-type': 'application/json', ...ask.headers}, body: JSON.stringify(body)};
    const options = {env, engine: () => assert.fail('must not choose a live engine')};
    if (index === 0) {
      assert.equal(questionOf(ask, env).items[0].key, linkedInKey);
      const expected = storedAnswer(ask, env).reply;
      assert.deepEqual(JSON.parse(expected.content[0].text), {keep: [1]});
      assert.deepEqual(await (await modelFetch(`${url}/v1/messages`, init, options)).json(), expected);
      const response = await fetch(`${proxy.url}/v1/messages`, init);
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), expected);
    } else {
      const named = error => { assert.equal(error.code, 'E2E_AI_ANSWER_MISSING'); assert.match(error.message, /app\.visit site "E2E Unrecorded Portal .*has no stored answer/); return true; };
      assert.throws(() => storedAnswer(ask, env), named);
      await assert.rejects(modelFetch(`${url}/v1/messages`, init, options), named);
      const response = await fetch(`${proxy.url}/v1/messages`, init);
      assert.equal(response.status, 503); named((await response.json()).error);
    }
  }
  assert.equal(live, 0);
});

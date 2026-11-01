// Mail classifier identities and replay use the real three-item failureschannels miss.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import {test} from 'node:test';
import {answerFor, loadTable, questionOf, storedAnswer} from '../../lib/ai-answers.mjs';
import {message, responseOf, startAiProxy} from '../../lib/ai-proxy.mjs';
import {modelFetch} from '../../lib/model.mjs';
import {askOf, bodyOf, contextCase, engineCases, familyTests, mailCapture, recorded, tempTable} from '../ai-answers-engine-fixtures.mjs';

familyTests(['mail']);
const c = engineCases.find(c => c.name === 'mail');
// Independent, hand-transcribed semantic tuples; keys sort alphabetically, without harness helpers.
const tuples = [
  {body: 'Your security code is 000000. It expires in 10 minutes. If you did not request it, ignore this email.', from: 'no-reply@us.greenhouse-mail.io', subject: 'Security code for your application to Acme Labs'},
  {body: 'Hi Alex, we would like to invite you to an interview for the DevOps Engineer role at Initech on Tuesday 6 October 2026 at 14:00 CEST on Zoom. Please confirm.', from: 'recruiter@initech-hr.test', subject: 'Interview invitation: DevOps Engineer at Initech'},
  {body: 'Hi Alex, we received your application for Senior Site Reliability Engineer at Acme Labs. Our team will review it and be in touch.', from: 'no-reply@us.greenhouse-mail.io', subject: 'Thank you for applying to Acme Labs'},
];
const context = createHash('sha256').update(mailCapture.system[0].text).digest('hex').slice(0, 12);
const keys = tuples.map(tuple => `default/mail/${context}/${createHash('sha256').update(JSON.stringify(tuple)).digest('hex')}`);

contextCase('mail', body => { body.system[0].text = body.system[0].text.replace('(none)', '0. Acme Labs — SRE'); });

const applications = '0. Acme Labs — SRE\n1. Initech — DevOps Engineer';
for (const [name, system, changedSystem] of [
  ['application order', c.system.replace('(none)', applications), c.system.replace('(none)', '0. Initech — DevOps Engineer\n1. Acme Labs — SRE')],
  ['classifier policy', c.system, c.system.replace('Answer for every item index.', 'Answer only for relevant item indexes.')],
]) test(`mail: changed ${name} refuses stored rows in both provider formats`, t => {
  const {table} = recorded(t, {...c, system});
  for (const shape of ['anthropic', 'openai']) {
    const ask = value => askOf(c, bodyOf({...c, system: value}, shape));
    assert.deepEqual(JSON.parse(answerFor(questionOf(ask(system), {}), table).reply.content[0].text), c.reply);
    const changed = questionOf(ask(changedSystem), {});
    assert.equal(changed.operation, 'mail');
    assert.match(answerFor(changed, table).missing, /^mail item /);
  }
});

test('captured mail keys include system context, ignore clock Dates and trim fields', () => {
  const request = {headers: {'x-jp-action': 'mail'}, body: mailCapture};
  const q = questionOf(request, {});
  assert.equal(q.operation, 'mail');
  assert.deepEqual(q.items.map(item => item.key), keys);
  const dates = structuredClone(mailCapture);
  dates.messages[0].content = dates.messages[0].content.replace(/^Date: .*$/m, 'Date: 2035-01-01T00:00:00+00:00');
  assert.deepEqual(questionOf({...request, body: dates}, {}).items.map(item => item.key), keys);
  const changed = structuredClone(mailCapture);
  changed.messages[0].content = changed.messages[0].content.replace('Please confirm.', 'Please reply.');
  const changedKeys = questionOf({...request, body: changed}, {}).items.map(item => item.key);
  assert.equal(changedKeys[0], keys[0]); assert.notEqual(changedKeys[1], keys[1]); assert.equal(changedKeys[2], keys[2]);
  const padded = structuredClone(mailCapture);
  padded.messages[0].content = padded.messages[0].content.replace(/^(From|Subject): (.*)$/gm, '$1:  $2  ').replace(/\n\n(?!### Item )/g, '\n\n  ') + '  ';
  assert.deepEqual(questionOf({...request, body: padded}, {}).items.map(item => item.key), keys);
  const empty = structuredClone(mailCapture);
  empty.messages[0].content = empty.messages[0].content.replace(tuples[2].body, '');
  const emptyKey = `default/mail/${context}/${createHash('sha256').update(JSON.stringify({...tuples[2], body: ''})).digest('hex')}`;
  assert.deepEqual(questionOf({...request, body: empty}, {}).items.map(item => item.key), [...keys.slice(0, 2), emptyKey]);
  assert.deepEqual(questionOf(request, {E2E_QUALITY_PERSONA: 'photographer'}).items.map(item => item.key), keys.map(key => key.replace('default/', 'photographer/')));
});

test('mail refuses a block missing From or Subject by family name', () => {
  for (const field of ['From', 'Subject']) {
    const body = bodyOf(c);
    body.messages[0].content = body.messages[0].content.replace(new RegExp(`^${field}: .*\\n`, 'm'), '');
    assert.match(questionOf(askOf(c, body), {}).unkeyable, new RegExp(`^mail: .*${field}`));
  }
});

test('mail table rows omit request indexes and reject fields outside the closed schema', t => {
  const {items} = recorded(t, c), rows = items.mail;
  for (const entry of Object.values(rows)) assert.ok(!Object.hasOwn(entry.answer, 'index'));
  const {file} = tempTable(t, items);
  rows[keys[0]].answer.unexpected = true;
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items}));
  assert.throws(() => loadTable(file), /AI answers: mail\/.*valid engine answer/);
});

for (const shape of ['anthropic', 'openai']) test(`mail ${shape}: Greenhouse and interview rows serve or refuse by name at all three seams with zero calls`, async t => {
  const {q, items} = recorded(t, c), rows = items.mail;
  const {file, env} = tempTable(t, items);
  const saved = {...process.env}; Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  let live = 0, engines = 0, relays = 0;
  const upstream = http.createServer((_req, res) => { live++; res.writeHead(500); res.end('forbidden live call'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); return new Promise(resolve => upstream.close(resolve)); });
  const url = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = await startAiProxy({target: url, shape, relay: () => { relays++; throw new Error('must not relay'); }});
  t.after(() => proxy.close());
  const body = bodyOf(c, shape), pathname = shape === 'openai' ? '/v1/responses' : '/v1/messages';
  const init = {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)};
  const ask = {url: pathname, headers: init.headers, body};
  const options = {env, engine: () => { engines++; throw new Error('must not select engine'); }};
  for (const index of [0, 1]) {
    env.E2E_AI_ANSWERS = process.env.E2E_AI_ANSWERS = 'backbone';
    const entry = rows[keys[index]]; delete rows[keys[index]];
    fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items}));
    const named = error => {
      assert.equal(error.code, 'E2E_AI_ANSWER_MISSING');
      assert.ok(error.message.includes(`mail item ${JSON.stringify(tuples[index].subject)} key ${keys[index]} has no stored answer`));
      return true;
    };
    assert.throws(() => storedAnswer(ask, env), named);
    await assert.rejects(modelFetch(`${url}${pathname}`, init, options), named);
    const missing = await fetch(`${proxy.url}${pathname}`, init);
    assert.equal(missing.status, 503); named((await missing.json()).error);
    rows[keys[index]] = entry;
    fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items}));
    for (const mode of ['off', 'backbone', 'record']) {
      env.E2E_AI_ANSWERS = process.env.E2E_AI_ANSWERS = mode;
      const expected = JSON.stringify(c.reply);
      assert.deepEqual(storedAnswer(ask, env), {reply: message(expected)});
      assert.deepEqual(await (await modelFetch(`${url}${pathname}`, init, options)).json(), message(expected));
      const response = await fetch(`${proxy.url}${pathname}`, init);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), shape === 'openai' ? responseOf(expected) : message(expected));
    }
  }
  assert.equal(q.items.length, 3);
  assert.equal(live, 0); assert.equal(engines, 0); assert.equal(relays, 0); assert.equal(proxy.stats.paid || 0, 0);
});

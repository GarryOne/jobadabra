// The fake Bot API records what a person would receive and refuses on demand; the digest check catches what must never reach them.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {digestProblems, fields, startTelegramFake} from '../../lib/telegram-fake.mjs';

test('a form post (the engine) and a JSON post (the app) are both read', () => {
  assert.deepEqual(fields('application/x-www-form-urlencoded', 'chat_id=42&text=hi'), {chat_id: '42', text: 'hi'});
  assert.deepEqual(fields('application/json', '{"chat_id":42}'), {chat_id: 42});
});

test('messages are recorded; a refusal answers like Telegram; getUpdates is empty', async () => {
  const fake = await startTelegramFake();
  try {
    const post = (method, body) => fetch(`${fake.url}/bot123:x/${method}`, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body)});
    assert.equal((await (await post('sendMessage', {chat_id: '42', text: '✈️ hello'})).json()).ok, true);
    assert.deepEqual(fake.sent.map(item => [item.chat, item.text]), [['42', '✈️ hello']]);
    assert.deepEqual((await (await post('getUpdates', {})).json()).result, []);
    fake.fail('blocked');
    const refused = await post('sendMessage', {chat_id: '42', text: 'x'});
    assert.equal(refused.status, 403);
    assert.match((await refused.json()).description, /blocked/);
    assert.equal(fake.sent.length, 1);
  } finally { await fake.close(); }
});

test('a digest with technical text, an empty promise or over Telegram\'s limit is a problem; a normal one is not', () => {
  const good = '✈️ <b>Jobadabra</b> · 🆕 1 new · top 1 of 1\n<i>1 open</i>\n1. SRE (https://x/1) · 🎯 80\n   Acme · Zurich';
  assert.deepEqual(digestProblems(good), []);
  assert.match(digestProblems('✈️ Jobadabra · top 2 of 5\nnothing').join(), /promises jobs but none is listed/);
  assert.match(digestProblems(good.replace('Acme', 'undefined')).join(), /technical text/);
  assert.match(digestProblems(`✈️ ${'x'.repeat(5000)}`).join(), /4096/);
  assert.match(digestProblems('hello').join(), /header/);
});

// The pool's fill card (lib/pool-card.mjs): only fixed words and counts, built by the user's own fillCard/causeOf, and sent under the same guard as the applying report.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {poolCard, sendPoolCard, endHost} from '../../lib/pool-card.mjs';
import {fieldLines, parseLive} from '../../lib/record-sites.mjs';

const NO_ANSWER = 'no answer in the kit, Profile or your details';
const result = {reached: 'form', signature: 'other>form@acme.wd3.myworkdayjobs.com#form', fieldList: [
  {outcome: 'filled', type: 'text', label: 'Jane Doe secret first name', required: true, reason: ''},
  {outcome: 'left', type: 'select', label: 'Country of Berne Street 5', required: true, reason: 'menu opened, no trusted click'},
  {outcome: 'left', type: 'text', label: 'Notice period', required: true, reason: NO_ANSWER},
  {outcome: 'left', type: 'text', label: 'Optional thing', required: false, reason: 'whatever'}]};

test('a card holds only fixed words: no label, address, host or reason text, and the board is a name or a hash', () => {
  const card = poolCard('Acme Workday', result, {day: '2026-10-12', version: '0.9.140'});
  assert.equal(card.source, 'pool');
  assert.equal(card.board, 'workday');
  assert.match(card.id, /^pool-2026-10-12-[0-9a-f]{8}$/);
  assert.deepEqual([card.required, card.filled, card.left], [3, 1, 2]);
  assert.deepEqual(card.causes, {other: 1, no_data: 1});
  assert.equal(card.causes.no_data, 1);
  const wire = JSON.stringify(card);
  assert.ok(!/Jane|secret|Berne|Notice|acme|myworkday|trusted click|http|Optional thing/i.test(wire), wire);
  assert.equal(poolCard('x', {...result, signature: 'other>form@some-unknown-employer.ch#form'}, {day: '2026-10-12'}).board.slice(0, 2), 'h:');
});

test('no form reached, no fields read or no end host: no card', () => {
  assert.equal(poolCard('x', {reached: 'posting', fieldList: result.fieldList}, {day: '2026-10-12'}), null);
  assert.equal(poolCard('x', {reached: 'form', fieldList: []}, {day: '2026-10-12'}), null);
  assert.equal(poolCard('x', {...result, signature: 'unclear'}, {day: '2026-10-12'}), null);
  assert.equal(endHost('a>b@x.y.com#form'), 'x.y.com');
});

test('never sent from CI, a control run on an old build or JP_NO_REPORT, and the key is never in the outcome line', async () => {
  const card = poolCard('x', result, {day: '2026-10-12'});
  let calls = 0;
  const fetcher = async () => { calls++; return {ok: true}; };
  for (const env of [{CI: '1'}, {REAL_EXTENSION_DIR: '/tmp/old'}, {JP_NO_REPORT: '1'}]) assert.match(await sendPoolCard(card, {env, key: 'SECRET', fetcher}), /not sent/);
  assert.equal(calls, 0);
  let sent;
  const line = await sendPoolCard(card, {env: {}, key: 'SECRET', fetcher: async (url, init) => { sent = {url, init}; return {ok: true}; }});
  assert.match(line, /sent \(workday/);
  assert.ok(!line.includes('SECRET'));
  assert.equal(sent.init.headers.Authorization, 'Bearer SECRET');
  assert.match(sent.url, /\/api\/controls$/);
  assert.equal(JSON.parse(sent.init.body).cards[0].source, 'pool');
});

test('a reason of up to 160 characters survives the log line, so causeOf sees the whole reason', () => {
  const reason = 'a'.repeat(150);
  const line = `x fill: fields: 0 filled, 1 left ${JSON.stringify({fields: [{outcome: 'left', type: 'text', label: 'Q', required: true, reason}]})}`;
  assert.equal(parseLive(['  live 0s: Apply pressed on https://x/', ...fieldLines(line)].join('\n')).fieldList[0].reason, reason);
});

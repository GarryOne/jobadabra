// A salary asked in another currency or period is converted by the code at a daily rate and rounded to a clean figure (owner, 15 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { typeGuess } from '../src/answer-facts.js';
import { convertPay, applyPay, ratesToday, forgetRatesForTests, FALLBACK_PER_EUR } from '../src/pay-convert.js';

const rates = { EUR: 1, CHF: 0.9, USD: 1.1 };
const eurYear = { field: 'pay', amount: 140000, currency: 'EUR', per: 'year', asked_currency: 'CHF', asked_per: 'year', basis_clear: true };

test('EUR 140,000 a year on a CHF form is a CHF figure rounded to 1,000; a month to 100; a number field gets plain digits', () => {
  assert.equal(convertPay(eurYear, { type: 'text' }, { rates }), 'CHF 126000');
  assert.equal(convertPay(eurYear, { type: 'number' }, { rates }), '126000');
  assert.equal(convertPay({ ...eurYear, asked_per: 'month' }, { type: 'number' }, { rates }), '10500');   // 126000 / 12 = 10500
  assert.equal(convertPay({ ...eurYear, amount: 85000, asked_currency: 'USD', asked_per: 'month' }, { type: 'text' }, { rates }), 'USD 7800');   // 93500 / 12 = 7791.67 -> nearest 100
  assert.equal(convertPay({ ...eurYear, amount: 7800, per: 'month', asked_per: 'year' }, { type: 'number' }, { rates }), '84000');
  for (const v of [convertPay(eurYear, { type: 'number' }, { rates }), convertPay({ ...eurYear, amount: 85534 }, { type: 'number' }, { rates })]) assert.match(v, /^\d+000$/, 'never decimals or an odd figure');
});

test('an unclear period or gross/net, an unknown currency or a missing amount is not converted', () => {
  for (const bad of [{ basis_clear: false }, { asked_per: '' }, { asked_currency: 'XXX' }, { amount: 0 }, { currency: 'eur' }]) assert.equal(convertPay({ ...eurYear, ...bad }, { type: 'text' }, { rates }), null);
});

test('applyPay types the converted answer and keeps an unconvertible one as a proposal', async () => {
  forgetRatesForTests();
  const fetchFn = async () => ({ text: async () => "<Cube><Cube currency='USD' rate='1.1'/><Cube currency='CHF' rate='0.9'/><Cube currency='GBP' rate='0.85'/><Cube currency='SEK' rate='11'/><Cube currency='NOK' rate='11'/><Cube currency='PLN' rate='4'/></Cube>" });
  const answers = [{ field: 'pay', value: 'EUR 140,000', use: 'fill', fact: 'salary' }, { field: 'pay2', value: 'x', use: 'fill', fact: 'salary' }];
  const out = await applyPay(answers, [eurYear, { ...eurYear, field: 'pay2', basis_clear: false }], [{ field: 'pay', type: 'text' }, { field: 'pay2', type: 'text' }], { fetchFn });
  assert.equal(out[0].value, 'CHF 126000'); assert.equal(out[0].use, 'fill'); assert.equal(out[0].converted.rates, 'ecb');
  assert.equal(out[1].use, 'propose');
  assert.deepEqual(await applyPay([{ field: 'z', value: '8', use: 'fill', fact: 'years_experience' }], [], [], { fetchFn }), [{ field: 'z', value: '8', use: 'fill', fact: 'years_experience' }]);   // not a salary: untouched
});

test('without the rates site the fixed table is used, and a day is fetched once', async () => {
  forgetRatesForTests();
  let calls = 0; const down = async () => { calls++; throw new Error('offline'); };
  const first = await ratesToday({ fetchFn: down, now: Date.UTC(2026, 9, 15) });
  assert.equal(first.source, 'fallback'); assert.deepEqual(first.rates, FALLBACK_PER_EUR);
  await ratesToday({ fetchFn: down, now: Date.UTC(2026, 9, 15, 20) }); assert.equal(calls, 1);
  await ratesToday({ fetchFn: down, now: Date.UTC(2026, 9, 16) }); assert.equal(calls, 2);
  forgetRatesForTests();
});

test('answerForm: a pay_ask turns the AI\'s stated target into the converted, typed figure; the prompt tells the AI to leave the arithmetic to the code', async () => {
  const { answerForm, ANSWER_SCHEMA_FOR_TESTS } = await import('../src/extension.js');
  forgetRatesForTests();
  const seen = [];
  const client = { messages: { create: async (request) => { seen.push(request); return { stop_reason: 'end_turn', usage: { billing: 'subscription' }, content: [{ type: 'text', text: JSON.stringify({
    eligible: true, eligibility_note: '',
    answers: [{ field: 'pay', value: 'EUR 140000', confidence: 'high', note: '', category: 'normal', use: 'fill', fact: 'salary' }],
    pay_asks: [{ field: 'pay', amount: 140000, currency: 'EUR', per: 'year', asked_currency: 'CHF', asked_per: 'year', basis_clear: true }] }) }] }; } } };
  const down = async () => { throw new Error('offline'); };
  const out = await answerForm({ PROFILE_TEXT: 'Salary target: EUR 140000 a year gross', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '', fetchFn: down },
    { url: 'https://example.test/job/1', fields: [{ field: 'pay', label: 'Desired pay (CHF per year, gross)', type: 'number', required: true }] }, client);
  assert.equal(out.answers[0].value, String(Math.round(140000 * FALLBACK_PER_EUR.CHF / 1000) * 1000));   // the fixed table: offline
  assert.equal(out.answers[0].use, 'fill'); assert.equal(out.answers[0].converted.rates, 'fallback');
  assert.ok(ANSWER_SCHEMA_FOR_TESTS.required.includes('pay_asks'));
  assert.match(seen[0].system[0].text, /pay_asks[^.]*the code converts it, never you/);
  forgetRatesForTests();
});

test('a typed salary the AI did not list in pay_asks is only proposed; a listed same-currency one stays typed', async () => {
  const fields = [{ field: 'a', type: 'text' }, { field: 'b', type: 'text' }];
  const out = await applyPay([{ field: 'a', value: 'CHF 150000', use: 'fill', fact: 'salary' }, { field: 'b', value: 'CHF 150000', use: 'fill', fact: 'salary' }],
    [{ field: 'b', amount: 150000, currency: 'CHF', per: 'year', asked_currency: 'CHF', asked_per: 'year', basis_clear: true }], fields, {});
  assert.deepEqual(out.map((a) => a.use), ['propose', 'fill']);
  assert.equal((await applyPay([{ field: 'a', value: '1', use: 'fill', fact: 'salary' }], [], fields, {}))[0].use, 'propose');
  assert.equal((await applyPay([{ field: 'a', value: '1', use: 'fill', fact: 'years_experience' }], [], fields, {}))[0].use, 'fill');
});

test('an answer the AI listed in pay_asks is a salary answer even when it named another fact', async () => {
  const fields = [{ field: 'a', type: 'text' }];
  const out = await applyPay([{ field: 'a', value: 'CHF 150000', use: 'fill', fact: 'none' }],
    [{ field: 'a', amount: 150000, currency: 'CHF', per: 'year', asked_currency: 'CHF', asked_per: 'year', basis_clear: true }], fields, {});
  assert.equal(out[0].fact, 'salary'); assert.equal(out[0].use, 'fill');
});

test('a salary the code kept as a proposal is not typed back as a guess', () => {
  const kept = typeGuess({ field: 'a', value: '150000', use: 'propose', fact: 'salary', category: 'normal', confidence: 'high' });
  assert.equal(kept.use, 'propose'); assert.equal(kept.guess, undefined);
});

// 27 Oct 2026, fair round form 106: "What are your salary expectations for this role? A range is fine." (a text box, no currency or period named) left empty in 3 of 3 runs:
// the AI gave the stated target in its own currency but held it as a proposal for the code to convert, and the code had nothing to convert.
test('the stated target in its own currency and period is typed in a text box that names its currency, even when the AI held it as a proposal', async () => {
  const fields = [{ field: 'a', type: 'text' }, { field: 'b', type: 'text' }, { field: 'c', type: 'number' }];
  const ask = (field) => ({ field, amount: 150000, currency: 'CHF', per: 'year', asked_currency: 'CHF', asked_per: 'year', basis_clear: false });
  const out = await applyPay([
    { field: 'a', value: 'CHF 140,000–160,000 per year, gross', use: 'propose', fact: 'salary' },
    { field: 'b', value: '140,000–160,000', use: 'propose', fact: 'salary' },   // a bare figure in a text box could be read in another currency: still a proposal
    { field: 'c', value: '150000', use: 'propose', fact: 'salary' },
  ], ['a', 'b', 'c'].map(ask), fields, {});
  assert.deepEqual(out.map((a) => a.use), ['fill', 'propose', 'fill']);
  assert.equal(typeGuess({ ...out[0], category: 'normal', confidence: 'medium' }).use, 'fill', 'the guess floor does not take it back');
});

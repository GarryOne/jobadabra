// The answer control matches the question's kind (owner, 17 Oct 2026: a checkbox, a single choice and dropdowns were all drawn as text boxes).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {answerControl, kindPicker} = await import('../renderer/question-control.js');
const {formatFor} = await import('../renderer/question-kind.js');
const click = node => node.listeners.click?.forEach(fn => fn({preventDefault() {}}));
const fire = (node, type) => node.listeners[type]?.forEach(fn => fn({}));
const texts = node => node.children.map(child => child.textContent);

test('each kind draws its control', () => {
  const draw = format => answerControl(formatFor({marked: format}), '', () => {});
  assert.equal(draw(null).tagName, 'INPUT');
  assert.equal(draw({kind: 'long_text'}).tagName, 'TEXTAREA');
  const yesNo = draw({kind: 'yes_no'});
  assert.ok(yesNo.className.includes('segmented'));
  assert.deepEqual(texts(yesNo), ['Yes', 'No']);
  const title = draw({kind: 'single', options: ['Mr', 'Mrs', 'Ms']});
  assert.ok(title.className.includes('segmented'), 'a few short options: one click');
  const permit = draw({kind: 'single', options: ['Swiss citizen', 'EU/EFTA citizen', 'C permit', 'B permit', 'None of these']});
  assert.equal(permit.tagName, 'SELECT');
  assert.deepEqual(texts(permit), ['Choose…', 'Swiss citizen', 'EU/EFTA citizen', 'C permit', 'B permit', 'None of these']);
  const country = draw({kind: 'single', list: 'countries'});
  assert.equal(country.tagName, 'SELECT');
  assert.ok(texts(country).includes('Switzerland'));
  assert.equal(draw({kind: 'single', options: []}).tagName, 'INPUT', 'a choice with no known options is typed');
  assert.equal(draw({kind: 'multi', options: ['English', 'German']}).dataset.answerKind, 'multi');
});

test('Yes / No gives the meaning, and a second press clears it', () => {
  const seen = [];
  const node = answerControl(formatFor({marked: {kind: 'yes_no'}}), '', value => seen.push(value));
  click(node.children[0]);
  assert.equal(node.value, 'Yes');
  assert.ok(node.children[0].className.includes('is-active'));
  click(node.children[0]);
  assert.deepEqual(seen, ['Yes', '']);
});

test('several picks become one line', () => {
  const seen = [];
  const node = answerControl(formatFor({marked: {kind: 'multi', options: ['English', 'German', 'French']}}), 'English', value => seen.push(value));
  click(node.children[2]);
  click(node.children[0]);
  assert.deepEqual(seen, ['English, French', 'French']);
});

test('a menu keeps an answer saved in other words', () => {
  const node = answerControl(formatFor({marked: {kind: 'single', options: ['Swiss citizen', 'EU/EFTA citizen', 'C permit', 'B permit']}}), 'EU citizen, B permit', () => {});
  assert.ok(texts(node).includes('EU citizen, B permit'));
});

test('the person can change a question\'s kind', () => {
  const picked = [];
  const node = kindPicker('single', kind => picked.push(kind));
  assert.equal(node.value, 'single');
  node.value = 'yes_no';
  fire(node, 'change');
  assert.deepEqual(picked, ['yes_no']);
});

const typed = (node, value) => { node.value = value; fire(node, 'input'); };
test('a date is a calendar input saved in the person\'s words; free text stays visible until a date is picked', () => {
  const seen = [];
  const node = answerControl(formatFor({marked: {kind: 'date'}}), '', value => seen.push(value));
  const input = node.querySelector('input');
  assert.equal(input.type, 'date');
  assert.equal(node.dataset.answerKind, 'date');
  assert.equal(node.complete, false);
  typed(input, '2026-12-01');
  assert.deepEqual(seen, ['1 December 2026']);
  assert.equal(node.value, '1 December 2026');
  assert.equal(node.complete, true);
  const old = answerControl(formatFor({marked: {kind: 'date'}}), 'as soon as possible', () => {});
  assert.equal(old.value, 'as soon as possible', 'nothing lost');
  assert.match(old.textContent, /Saved as: as soon as possible/);
  assert.equal(old.complete, true);
  assert.equal(answerControl(formatFor({marked: {kind: 'date'}}), '1 December 2026', () => {}).querySelector('input').value, '2026-12-01');
});

test('a date that also asks about constraints is complete only with constraints or "No constraints"', () => {
  const seen = [];
  const node = answerControl(formatFor({marked: {kind: 'date', constraints: true}}), '', value => seen.push(value));
  typed(node.querySelector('input'), '2026-12-01');
  assert.equal(node.complete, false, 'a date alone is not an answer');
  const [none, add] = node.querySelector('.segmented').children;
  assert.deepEqual(texts(node.querySelector('.segmented')), ['No constraints', '+ Add constraints']);
  click(none);
  assert.equal(node.value, '1 December 2026; no constraints');
  assert.equal(node.complete, true);
  click(add);
  assert.equal(node.complete, false, 'adding constraints needs the text');
  typed(node.querySelectorAll('input').find(each => each.type === 'text'), 'part-time until June');
  assert.equal(node.value, '1 December 2026; part-time until June');
  assert.equal(node.complete, true);
  const saved = answerControl(formatFor({marked: {kind: 'date', constraints: true}}), '1 January 2027; no constraints', () => {});
  assert.equal(saved.complete, true);
  assert.equal(saved.querySelector('input').value, '2027-01-01');
  const dateOnly = answerControl(formatFor({marked: {kind: 'date', constraints: true}}), '1 January 2027', () => {});
  assert.equal(dateOnly.complete, false, 'an old date-only answer to such a question asks for the constraints');
});

test('an amount is a number and a currency, saved together; free text stays visible', () => {
  const seen = [];
  const node = answerControl(formatFor({marked: {kind: 'amount'}}), '', value => seen.push(value));
  const [number, currency] = [node.querySelector('input'), node.querySelector('select')];
  assert.equal(number.type, 'number');
  assert.deepEqual(texts(currency), ['CHF', 'EUR', 'USD', 'GBP']);
  assert.equal(node.complete, false);
  typed(number, '95000');
  assert.equal(node.value, '95000 CHF');
  currency.value = 'EUR';
  fire(currency, 'change');
  assert.deepEqual(seen, ['95000 CHF', '95000 EUR']);
  const back = answerControl(formatFor({marked: {kind: 'amount'}}), '80000 SEK', () => {});
  assert.equal(back.querySelector('input').value, '80000');
  assert.ok(texts(back.querySelector('select')).includes('SEK'), 'a saved currency stays a choice');
  const free = answerControl(formatFor({marked: {kind: 'amount'}}), 'about 90k', () => {});
  assert.equal(free.value, 'about 90k');
  assert.match(free.textContent, /Saved as: about 90k/);
});

// Why (28 Oct 2026, owner's screenshot): a value still asked (the template's "❓ …") is no saved answer, so it never shows as "Saved as".
test('an asked value is not drawn as "Saved as"', () => {
  const node = answerControl(formatFor({marked: {kind: 'yes_no'}}), '❓ your citizenship and status', () => {});
  assert.doesNotMatch(node.textContent, /Saved as/);
});

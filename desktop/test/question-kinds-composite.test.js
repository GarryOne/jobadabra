// The six kinds added for base facts (owner, 17 Oct 2026: "Base facts fixed, AI the rest"): salary, duration, link, per country, language, range.
// Each has a mark in the store, a parser/writer that loses nothing, and a control; the AI may judge only the free-standing ones.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const kind = await import('../renderer/question-kind.js');
const values = await import('../renderer/question-values.js');
const {answerControl} = await import('../renderer/question-control.js');
const formats = await import('../lib/question-formats.js');
const {KINDS, AI_KINDS, formatFor, markOf, splitMark, withMark} = kind;
const NEW = ['salary', 'duration', 'link', 'per_country', 'language', 'range'];
const fire = (node, type) => node.listeners[type]?.forEach(fn => fn({}));

test('the six kinds exist, each with a mark that round-trips through the store line', () => {
  for (const each of NEW) assert.ok(KINDS.includes(each), each);
  assert.equal(KINDS.length, 13);
  for (const each of NEW) {
    const line = withMark('Notice period: 1 month', {kind: each});
    const back = splitMark(line);
    assert.equal(back.text, 'Notice period: 1 month', each);
    assert.equal(back.kind, each);
    assert.equal(back.marked, true);
  }
  assert.equal(markOf({kind: 'salary'}), '[salary]');
  assert.equal(markOf({kind: 'per_country'}), '[per country]');
});

test('the AI may judge salary, duration and link; the composite base facts are never its pick', () => {
  assert.deepEqual(NEW.filter(each => AI_KINDS.includes(each)), ['salary', 'duration', 'link']);
  assert.ok(AI_KINDS.includes('amount') && !AI_KINDS.includes('per_country') && !AI_KINDS.includes('language') && !AI_KINDS.includes('range'));
  assert.ok(kind.KINDS_VERSION >= 3, 'older judgments are asked again once');
  const reply = {content: [{type: 'text', text: JSON.stringify({formats: [
    {label: 'Gehaltsvorstellung', kind: 'salary', constraints: false, options: [], list: ''},
    {label: 'Kündigungsfrist', kind: 'duration', constraints: false, options: [], list: ''},
    {label: 'Eligible?', kind: 'per_country', constraints: false, options: [], list: ''}]})}]};
  const out = formats.judged(reply, ['Gehaltsvorstellung', 'Kündigungsfrist', 'Eligible?']);
  assert.deepEqual(out.map(each => each.kind), ['salary', 'duration']);
});

test('salary: amount, currency, period, net or gross; today\'s "95000 CHF" and free text lose nothing', () => {
  const {splitSalary, joinSalary} = values;
  assert.deepEqual(splitSalary('150000 CHF/year gross'), {number: '150000', currency: 'CHF', period: 'year', basis: 'gross'});
  assert.deepEqual(splitSalary('10000 CHF/month net'), {number: '10000', currency: 'CHF', period: 'month', basis: 'net'});
  assert.deepEqual(splitSalary('95000 CHF'), {number: '95000', currency: 'CHF', period: '', basis: ''}, 'an amount saved before the kind existed');
  assert.deepEqual(splitSalary('CHF 150,000 a year'), {number: '', currency: '', period: '', basis: ''}, 'wording the code cannot read stays text');
  assert.equal(joinSalary({number: '150000', currency: 'CHF', period: 'year', basis: 'gross'}), '150000 CHF/year gross');
  assert.equal(joinSalary({number: '95000', currency: 'CHF', period: '', basis: ''}), '95000 CHF');
  assert.equal(joinSalary({number: '', currency: 'CHF', period: 'year', basis: 'net'}), '');
});

test('duration: number, unit, and "ends at month-end"', () => {
  const {splitDuration, joinDuration} = values;
  assert.deepEqual(splitDuration('1 month, ends at month-end'), {number: '1', unit: 'month', monthEnd: true});
  assert.deepEqual(splitDuration('3 months'), {number: '3', unit: 'month', monthEnd: false});
  assert.deepEqual(splitDuration('2 weeks'), {number: '2', unit: 'week', monthEnd: false});
  assert.deepEqual(splitDuration('1 month to month-end'), {number: '', unit: '', monthEnd: false}, 'unread wording stays text');
  assert.equal(joinDuration({number: '1', unit: 'month', monthEnd: true}), '1 month, ends at month-end');
  assert.equal(joinDuration({number: '3', unit: 'month', monthEnd: false}), '3 months');
});

// Why (28 Oct 2026, owner, #2322): one fixed status per zone or country; "needs visa" reads as needs sponsorship, "allowed" never said how and stays as written.
// Why (28 Oct 2026, owner): a status only, no permit date or "only in" ("a bit too much, too in depth").
test('per country: yes freely, yes with a permit, or needs sponsorship; nothing more', () => {
  const {splitPermit, joinPermit} = values;
  assert.deepEqual(splitPermit('Yes, with a permit'), {status: 'yes, with a permit'});
  assert.deepEqual(splitPermit('Needs visa'), {status: 'no, needs sponsorship'});
  for (const unread of ['allowed, B permit', 'Swiss B Permit Authorized To Work', 'maybe']) assert.deepEqual(splitPermit(unread), {status: ''}, unread);
  assert.equal(joinPermit({status: 'yes, freely'}), 'yes, freely');
  assert.equal(joinPermit({status: ''}), '');
});

test('range and link', () => {
  const {splitRange, joinRange, isLink} = values;
  assert.deepEqual(splitRange('50–100 %'), {from: '50', to: '100'});
  assert.deepEqual(splitRange('50-100'), {from: '50', to: '100'});
  assert.deepEqual(splitRange('about half'), {from: '', to: ''});
  assert.equal(joinRange({from: '50', to: '100'}), '50–100 %');
  assert.equal(joinRange({from: '50', to: ''}), '');
  assert.ok(isLink('https://github.com/garry') && !isLink('github') && !isLink('javascript:alert(1)'));
});

test('each new kind draws its control and gives the answer as the store text', () => {
  const draw = (each, value, options = []) => {
    const seen = [];
    const node = answerControl(formatFor({marked: {kind: each, options}}), value, next => seen.push(next));
    return {node, seen};
  };
  assert.equal(draw('salary', '').node.dataset.answerKind, 'salary');
  const salary = draw('salary', '150000 CHF/year gross');
  assert.equal(salary.node.value, '150000 CHF/year gross');
  const selects = salary.node.children.filter(child => child.tagName === 'SELECT');
  assert.equal(selects.length, 3, 'currency, period, net or gross');
  assert.equal(draw('duration', '1 month, ends at month-end').node.value, '1 month, ends at month-end');
  assert.equal(draw('range', '50–100 %').node.value, '50–100 %');
  assert.equal(draw('per_country', 'allowed, B permit').node.value, 'allowed, B permit');
  assert.equal(draw('language', 'B2').node.value, 'B2');
  assert.equal(draw('link', 'https://github.com/garry').node.tagName, 'INPUT');
});

test('free text a kind cannot read stays visible and counts as an answer: nothing is lost', () => {
  for (const [each, text] of [['salary', 'about 90k'], ['duration', '1 month to month-end'], ['per_country', 'Swiss B Permit'], ['range', 'about half'], ['language', 'fluent']]) {
    const node = answerControl(formatFor({marked: {kind: each}}), text, () => {});
    assert.equal(node.value, text, each);
    assert.equal(node.complete, true, each);
  }
});

test('a salary edit writes one line; a missing number writes nothing', () => {
  const seen = [];
  const node = answerControl(formatFor({marked: {kind: 'salary'}}), '', next => seen.push(next));
  const number = node.children.find(child => child.tagName === 'INPUT');
  number.value = '120000';
  fire(number, 'input');
  assert.match(seen.at(-1), /^120000 [A-Z]{3}\/year gross$/);
  number.value = '';
  fire(number, 'input');
  assert.equal(seen.at(-1), '');
});

test('every kind has a name, a mark word and a control (a new kind added without them fails here)', () => {
  for (const each of KINDS) {
    assert.ok(kind.KIND_NAMES[each], `${each} has a name in "Answer as"`);
    if (each !== 'text') assert.ok(markOf({kind: each, options: ['A']}).startsWith('['), `${each} has a mark`);
    const node = answerControl(formatFor({marked: {kind: each, options: ['A', 'B']}}), '', () => {});
    assert.equal(node.dataset.answerKind, each === 'single' || each === 'multi' ? each : each, each);
  }
});

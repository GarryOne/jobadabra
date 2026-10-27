// A question's kind of answer (owner, 17 Oct 2026: a consent or a dropdown is not a text box): from the fill's field type, kept as a mark on the store's line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatFor, formatOfField, markOf, markFor, proposalIn, picksOf, splitMark, withMark, joinPicks, KINDS, dateWords, dateIso, splitConstraints, joinConstraints, splitAmount} from '../renderer/question-kind.js';

test('every fill field type maps to one kind, by structure only', () => {
  assert.deepEqual(formatOfField({type: 'text'}), {kind: 'text', options: []});
  assert.deepEqual(formatOfField({type: 'email'}), {kind: 'text', options: []});
  assert.deepEqual(formatOfField({type: 'textarea'}), {kind: 'long_text', options: []});
  assert.deepEqual(formatOfField({type: 'checkbox'}), {kind: 'yes_no', options: []});
  assert.deepEqual(formatOfField({type: 'select', options: ['Mr', 'Mrs', 'Mr', ' Ms ']}), {kind: 'single', options: ['Mr', 'Mrs', 'Ms']});
  assert.deepEqual(formatOfField({type: 'radio', options: ['Yes', 'No']}), {kind: 'single', options: ['Yes', 'No']});
  assert.deepEqual(formatOfField({type: 'combobox', options: [], multiple: true}), {kind: 'multi', options: []});
  assert.deepEqual(formatOfField({type: 'checkbox-group', options: [{text: 'A'}, {text: 'B'}]}), {kind: 'multi', options: ['A', 'B']});
});

test('the mark round-trips through the store text for every kind', () => {
  for (const kind of KINDS) {
    const format = {kind, options: kind === 'single' || kind === 'multi' ? ['Mr', 'Mrs', 'Ms'] : []};
    const line = withMark('Title: ❓ (asked by Adnovum)', format);
    const back = splitMark(line);
    assert.equal(back.text, 'Title: ❓ (asked by Adnovum)', kind);
    assert.equal(back.kind || 'text', kind);
    assert.deepEqual(back.options, format.options, kind);
  }
  assert.equal(withMark('Title: ❓', {kind: 'single', options: ['Mr', 'Mrs']}), 'Title: ❓ [pick one: Mr | Mrs]');
  assert.equal(withMark('Title: Mr [pick one: Mr | Mrs]', {kind: 'text'}), 'Title: Mr', 'a text kind removes the mark');
});

test('a long menu keeps only its kind in the store', () => {
  const countries = Array.from({length: 40}, (_, i) => `Country ${i}`);
  assert.equal(markOf({kind: 'single', options: countries}), '[pick one]');
  assert.equal(markOf({kind: 'single', options: ['A | B', 'C']}), '[pick one]', 'an option with a | would break the list');
  assert.equal(markOf({kind: 'yes_no', options: ['x']}), '[yes/no]');
  assert.equal(markOf({kind: 'text'}), '');
});

test('a line with no mark is not a kind; words in brackets that are not a mark stay text', () => {
  assert.deepEqual(splitMark('Notice period: 3 months'), {text: 'Notice period: 3 months', kind: '', options: [], marked: false});
  assert.equal(splitMark('Languages: English [fluent]').marked, false);
});

test('the store mark wins over this Mac; a long menu takes its options from this Mac', () => {
  assert.equal(formatFor({marked: {kind: 'single', options: ['Mr', 'Mrs']}, kept: {kind: 'text', options: []}}).control, 'single');
  const long = formatFor({marked: {kind: 'single', options: []}, kept: {kind: 'single', options: ['Switzerland', 'Germany']}});
  assert.deepEqual(long.options, ['Switzerland', 'Germany']);
  assert.equal(formatFor({kept: {kind: 'single', options: []}}).control, 'text', 'a choice with no known options is typed');
  assert.deepEqual(formatFor({kept: {kind: 'yes_no'}}).options, ['Yes', 'No']);
  assert.equal(formatFor({}).control, 'text');
  assert.equal(formatFor({kept: {kind: 'nonsense'}}).kind, 'text');
});

test('several picks are one line and read back', () => {
  assert.equal(joinPicks(['English', 'Romanian']), 'English, Romanian');
  assert.deepEqual(picksOf('english, Romanian, Klingon', ['English', 'Romanian', 'Russian']), ['English', 'Romanian']);
});

test('a country question offers every country, kept as one short mark', () => {
  assert.equal(markOf({kind: 'single', list: 'countries'}), '[pick a country]');
  const back = splitMark('Country/Region of Residence: ❓ (asked by Adnovum) [pick a country]');
  assert.equal(back.text, 'Country/Region of Residence: ❓ (asked by Adnovum)');
  const format = formatFor({marked: back});
  assert.equal(format.control, 'single');
  assert.ok(format.options.includes('Switzerland') && format.options.includes('Romania') && format.options.length > 240);
  assert.ok(!format.options.includes('Eurozone') && !format.options.includes('European Union'), 'regions that are not countries are left out');
  assert.ok(formatFor({kept: {kind: 'single', list: 'countries'}, locale: 'de'}).options.includes('Schweiz'), 'named in the person\'s language');
});

test('the mark a drawn format writes', async () => {
  const {markFor} = await import('../renderer/question-kind.js');
  assert.equal(markFor({kind: 'text'}), null);
  assert.deepEqual(markFor({kind: 'single', list: 'countries', options: ['A']}), {kind: 'single', options: [], list: 'countries'});
  assert.deepEqual(markFor({kind: 'yes_no', options: ['Yes', 'No']}), {kind: 'yes_no', options: []});
});

// PR 2b step 1: a deduced answer is offered only as one of the question's own options (unsure: none, the person answers).
test('proposalIn: the option that names the value, else nothing; text takes any value', async () => {
  const {proposalIn} = await import('../renderer/question-kind.js');
  assert.equal(proposalIn('no', {control: 'yes_no', options: ['Yes', 'No']}), 'No');
  assert.equal(proposalIn('Maybe', {control: 'yes_no', options: ['Yes', 'No']}), '');
  assert.equal(proposalIn('mr', {control: 'single', options: ['Mr', 'Mrs']}), 'Mr');
  assert.equal(proposalIn('Herr', {control: 'single', options: ['Mr', 'Mrs']}), '');
  assert.equal(proposalIn('English, french', {control: 'multi', options: ['English', 'French', 'German']}), 'English, French');
  assert.equal(proposalIn('3 months', {control: 'text', options: []}), '3 months');
  assert.equal(proposalIn('3 months', {control: 'textarea', options: []}), '3 months');
});

test('date and amount are kinds: a fill\'s date / number input gives them, by structure only', () => {
  assert.ok(KINDS.includes('date') && KINDS.includes('amount'));
  assert.deepEqual(formatOfField({type: 'date'}), {kind: 'date', options: []});
  assert.deepEqual(formatOfField({type: 'number'}), {kind: 'amount', options: []});
  assert.equal(formatOfField({type: 'text', label: 'Start date'}).kind, 'text', 'a label word never decides');
});

test('date and amount marks round-trip through the store text', () => {
  assert.equal(withMark('Start: ❓ (asked by Acme)', {kind: 'date'}), 'Start: ❓ (asked by Acme) [date]');
  assert.equal(withMark('Start: ❓', {kind: 'date', constraints: true}), 'Start: ❓ [date + constraints]');
  assert.equal(withMark('Pay: ❓', {kind: 'amount', options: ['CHF', 'EUR']}), 'Pay: ❓ [amount: CHF | EUR]');
  assert.equal(withMark('Pay: ❓', {kind: 'amount'}), 'Pay: ❓ [amount]');
  assert.deepEqual(splitMark('Start: ❓ [date + constraints]'), {text: 'Start: ❓', kind: 'date', options: [], constraints: true, marked: true});
  assert.equal(splitMark('Start: ❓ [date]').constraints, false);
  assert.deepEqual(splitMark('Pay: ❓ [amount: CHF | EUR]').options, ['CHF', 'EUR']);
  assert.deepEqual(markFor({kind: 'date', constraints: true, options: []}), {kind: 'date', options: [], constraints: true});
});

test('formatFor draws a date and an amount with their own control; a proposal is kept as typed', () => {
  assert.equal(formatFor({marked: {kind: 'date'}}).control, 'date');
  assert.equal(formatFor({marked: {kind: 'date', constraints: true}}).constraints, true);
  assert.equal(formatFor({kept: {kind: 'date', constraints: true}}).constraints, true, 'the AI judgment of this Mac');
  assert.equal(formatFor({marked: {kind: 'single', constraints: true, options: ['A']}}).constraints, false, 'constraints only on a date');
  assert.equal(formatFor({marked: {kind: 'amount'}, kept: {kind: 'text', constraints: true}}).constraints, false);
  assert.equal(formatFor({marked: {kind: 'date'}, kept: {kind: 'text', constraints: true}}).constraints, true, 'a [date] mark takes the AI\'s judgment of the label');
  assert.deepEqual(formatFor({marked: {kind: 'amount'}}).options, ['CHF', 'EUR', 'USD', 'GBP']);
  assert.deepEqual(formatFor({marked: {kind: 'amount', options: ['SEK']}}).options, ['SEK']);
  assert.equal(proposalIn('1 December 2026', {control: 'date'}), '1 December 2026');
  assert.equal(proposalIn('95000 CHF', {control: 'amount'}), '95000 CHF');
});

test('a date is saved in the person\'s words and read back; free text is not a date', () => {
  assert.equal(dateWords('2026-12-01'), '1 December 2026');
  assert.equal(dateIso('1 December 2026'), '2026-12-01');
  assert.equal(dateIso('2026-12-01'), '2026-12-01');
  assert.equal(dateIso('2026-02-31'), '', 'invalid calendar dates stay unconverted');
  assert.equal(dateIso('31 February 2026'), '', 'invalid saved dates stay visible as saved text');
  assert.equal(dateIso('2024-02-29'), '2024-02-29', 'date-only ISO values do not shift through a timezone');
  assert.equal(dateIso('as soon as possible'), '');
  assert.deepEqual(splitConstraints('1 December 2026; no constraints'), {date: '1 December 2026', constraints: 'none'});
  assert.deepEqual(splitConstraints('1 December 2026; part-time until June'), {date: '1 December 2026', constraints: 'part-time until June'});
  assert.deepEqual(splitConstraints('1 December 2026'), {date: '1 December 2026', constraints: ''});
  assert.equal(joinConstraints('1 December 2026', 'none'), '1 December 2026; no constraints');
  assert.deepEqual(splitAmount('95000 CHF'), {number: '95000', currency: 'CHF'});
  assert.deepEqual(splitAmount('about 90k'), {number: '', currency: ''});
});

// Work eligibility by zone (#2322, renderer/work-eligibility.js): Nationality concludes the zones it opens, a status settles a country's right to work and
// sponsorship by a fixed table, and a row is a zone or a country, never a city. Values are fictional.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {countryCode, eligibilityOf, isAnswered, isRowName, nationalityOf, rowFor, settles, zonesOpenedBy} from '../renderer/work-eligibility.js';
import {joinPermit, splitPermit} from '../renderer/question-values.js';

test('a country is known by its English name, never a city or a mix; a row is one of the three zones only', () => {
  assert.equal(countryCode('Romania'), 'RO');
  assert.equal(countryCode(' switzerland '), 'CH');
  for (const name of ['Iasi', 'Zurich', 'Germany / EU', '', 'Bavaria']) assert.equal(countryCode(name), '', name);
  assert.ok(isRowName('EU / EEA + Switzerland') && isRowName('United Kingdom'));
  assert.ok(!isRowName('Canada'), 'no added country (owner, 28 Oct 2026: "there is no point for Add a country")');
  assert.ok(!isRowName('Authorised to work in Iasi, Romania?'));
});

test('Nationality is one or more country names; anything else needs a check', () => {
  assert.deepEqual(nationalityOf('Romania, Moldova'), ['Romania', 'Moldova']);
  assert.deepEqual(nationalityOf('romania; Romania'), ['Romania']);
  assert.equal(nationalityOf('EU citizen (Romania)'), null);
  assert.equal(nationalityOf('Bucharest'), null);
  assert.equal(nationalityOf(''), null);
});

test('a nationality opens its zones freely (an Irish citizen the UK too); the rest stay to ask', () => {
  assert.deepEqual(zonesOpenedBy(['Romania']), ['eu']);
  assert.deepEqual(zonesOpenedBy(['Ireland']), ['eu', 'uk']);
  assert.deepEqual(zonesOpenedBy(['United Kingdom', 'United States']), ['uk', 'us']);
  assert.deepEqual(zonesOpenedBy(['Moldova']), []);
  assert.deepEqual(zonesOpenedBy(null), []);
});

test('eligibilityOf: saved rows first, a zone the nationality opens is concluded, a saved row beats the conclusion', () => {
  const lines = [{label: 'Nationality', value: 'Romania'}, {label: 'United States', value: 'no, needs sponsorship', kind: 'per_country'},
    {label: 'Remote from your country for a foreign employer?', value: 'Yes'}];
  assert.deepEqual(eligibilityOf(lines), {nationality: ['Romania'], rows: [{label: 'United States', value: 'no, needs sponsorship', from: 'saved'},
    {label: 'EU / EEA + Switzerland', value: 'yes, freely', from: 'nationality'}]});
  const own = eligibilityOf([...lines, {label: 'EU / EEA + Switzerland', value: 'yes, with a permit', kind: 'per_country'}]).rows;
  assert.deepEqual(own.filter(row => row.label === 'EU / EEA + Switzerland').map(row => row.from), ['saved'], 'never two answers for one zone');
});

test('settles: the fixed table; sponsorship is derived', () => {
  const at = status => [settles({status}, 'work_right'), settles({status}, 'sponsorship')];
  assert.deepEqual(at('yes, freely'), ['Yes', 'No']);
  assert.deepEqual(at('yes, with a permit'), ['Yes', 'No']);
  assert.deepEqual(at('no, needs sponsorship'), ['No', 'Yes']);
  assert.deepEqual(at(''), ['', '']);
});

test('rowFor: the zone that covers a country, else a citizenship of it; none for a country outside both', () => {
  const lines = [{label: 'Nationality', value: 'Canada'}, {label: 'EU / EEA + Switzerland', value: 'no, needs sponsorship', kind: 'per_country'}];
  assert.equal(rowFor('de', lines).label, 'EU / EEA + Switzerland');
  assert.deepEqual(rowFor('CA', lines), {label: 'Nationality', value: 'yes, freely', from: 'nationality'});
  assert.equal(rowFor('JP', lines), null);
  assert.equal(rowFor('', lines), null);
});

test('a permit value is its status only; words after it are kept by the control and read as that status', () => {
  assert.equal(joinPermit({status: 'yes, with a permit'}), 'yes, with a permit');
  assert.equal(joinPermit({status: 'maybe'}), '');
  assert.deepEqual(splitPermit('yes, with a permit, valid until 2027-06-30'), {status: 'yes, with a permit'});
  assert.deepEqual(splitPermit('needs visa'), {status: 'no, needs sponsorship'}, 'the older word');
  assert.equal(splitPermit('maybe a B permit').status, '');
});

// Why (28 Oct 2026, Gitar on #2322): the template writes each zone as "❓"; that is no answer, so a zone the nationality opens is still concluded.
test('a template "❓" zone is no answer: the nationality still concludes it', () => {
  assert.deepEqual(['yes, freely', '❓', '❓ yes, freely / no', '', '  '].map(isAnswered), [true, false, false, false, false]);
  const lines = [{label: 'Nationality', value: 'Romania'}, {label: 'EU / EEA + Switzerland', value: '❓', kind: 'per_country'}];
  assert.deepEqual(eligibilityOf(lines).rows, [{label: 'EU / EEA + Switzerland', value: 'yes, freely', from: 'nationality'}]);
});

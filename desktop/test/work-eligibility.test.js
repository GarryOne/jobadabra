// Work eligibility by zone (#2322, renderer/work-eligibility.js): Nationality concludes the zones it opens, a status settles a country's right to work and
// sponsorship by a fixed table, and a row is a zone or a country, never a city. Values are fictional.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {countryCode, eligibilityOf, isRowName, nationalityOf, rowFor, settles, zonesOpenedBy} from '../renderer/work-eligibility.js';
import {joinPermit, splitPermit} from '../renderer/question-values.js';

const NOW = new Date('2026-10-28T10:00:00Z');

test('a row is a zone or a country by its English name, never a city or a mix', () => {
  assert.equal(countryCode('Romania'), 'RO');
  assert.equal(countryCode(' switzerland '), 'CH');
  for (const name of ['Iasi', 'Zurich', 'Germany / EU', '', 'Bavaria']) assert.equal(countryCode(name), '', name);
  assert.ok(isRowName('EU / EEA + Switzerland') && isRowName('United Kingdom') && isRowName('Canada'));
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

test('settles: the fixed table; sponsorship is derived; an old or other-country permit settles nothing', () => {
  const freely = {status: 'yes, freely'}, needs = {status: 'no, needs sponsorship'};
  assert.deepEqual([settles(freely, 'work_right'), settles(freely, 'sponsorship')], ['Yes', 'No']);
  assert.deepEqual([settles(needs, 'work_right'), settles(needs, 'sponsorship')], ['No', 'Yes']);
  assert.equal(settles({status: 'yes, with a permit', until: '2027-06-30'}, 'work_right', 'DE', NOW), 'Yes');
  assert.equal(settles({status: 'yes, with a permit', until: '2026-01-31'}, 'work_right', 'DE', NOW), '', 'past its date');
  assert.equal(settles({status: 'yes, with a permit', only: 'Switzerland'}, 'sponsorship', 'CH', NOW), 'No');
  assert.equal(settles({status: 'yes, with a permit', only: 'Switzerland'}, 'work_right', 'DE', NOW), '', 'limited to another country');
  assert.equal(settles({status: ''}, 'work_right'), '');
});

test('rowFor: an added country beats its zone; a citizenship outside any zone still answers', () => {
  const lines = [{label: 'Nationality', value: 'Canada'}, {label: 'EU / EEA + Switzerland', value: 'no, needs sponsorship', kind: 'per_country'},
    {label: 'Switzerland', value: 'yes, with a permit', kind: 'per_country'}];
  assert.equal(rowFor('CH', lines).label, 'Switzerland');
  assert.equal(rowFor('de', lines).label, 'EU / EEA + Switzerland');
  assert.deepEqual(rowFor('CA', lines), {label: 'Nationality', value: 'yes, freely', from: 'nationality'});
  assert.equal(rowFor('JP', lines), null);
  assert.equal(rowFor('', lines), null);
});

test('a permit value round-trips through its one saved form; unreadable text gives empty parts', () => {
  const value = joinPermit({status: 'yes, with a permit', until: '2027-06-30', only: 'Switzerland'});
  assert.equal(value, 'yes, with a permit, valid until 2027-06-30, only in Switzerland');
  assert.deepEqual(splitPermit(value), {status: 'yes, with a permit', until: '2027-06-30', only: 'Switzerland'});
  assert.equal(splitPermit('maybe a B permit').status, '');
});

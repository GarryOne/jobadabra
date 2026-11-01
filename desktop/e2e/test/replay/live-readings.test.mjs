// Guards lib/live-readings.mjs without a browser: the false readings a live row's end can show (the canary on flow PRs): a contact box holding another value
// than the applicant's, a panel that counts fewer left than the page's own empty required controls, a "ready" with one left. Values never appear in a line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {contactKeyOf, liveFailures, parseReadings, readingsLine} from '../../lib/live-readings.mjs';

const CONTACT = {first_name: 'Ada', last_name: 'Tester', full_name: 'Ada Tester', email: 'ada.tester@example.test', phone: '+41 79 555 01 23'};

test('a contact box is known by the HTML autocomplete token or an email type, never by its label', () => {
  assert.equal(contactKeyOf({autocomplete: 'given-name'}), 'first_name');
  assert.equal(contactKeyOf({autocomplete: 'section-a billing family-name'}), 'last_name');
  assert.equal(contactKeyOf({autocomplete: 'tel-national'}), 'phone');
  assert.equal(contactKeyOf({autocomplete: 'off', type: 'email'}), 'email');
  assert.equal(contactKeyOf({autocomplete: 'off', type: 'text'}), '');
});

test('truth: a filled contact box holds the applicant\'s value; an empty one is not truth\'s; the line never carries a value', () => {
  const boxes = [{autocomplete: 'given-name', value: 'Ada'}, {autocomplete: 'family-name', value: 'Ada'}, {autocomplete: 'tel', value: '079 555 01 23'}, {type: 'email', value: ''}];
  assert.deepEqual(liveFailures({boxes, contact: CONTACT, panel: {present: false}, required: []}), ['truth: the family-name box holds another value than the applicant\'s last_name']);
});

test('agreement: the panel counts at least the page\'s own empty required controls; never "ready" with one left', () => {
  const page = [{name: 'Phone', empty: true}, {name: 'City', empty: false}];
  assert.deepEqual(liveFailures({boxes: [], contact: CONTACT, panel: {present: true, ready: false, left: 1}, required: page}), []);
  assert.deepEqual(liveFailures({boxes: [], contact: CONTACT, panel: {present: true, ready: false, left: 0}, required: page}), ['agreement: the page has 1 required control empty (Phone), the panel counts 0']);
  assert.deepEqual(liveFailures({boxes: [], contact: CONTACT, panel: {present: true, ready: true, left: 0}, required: page}),
    ['agreement: the page has 1 required control empty (Phone), the panel counts 0', 'ready: the panel says ready with 1 required left (Phone)']);
  assert.deepEqual(liveFailures({boxes: [], contact: CONTACT, panel: {present: true, ready: false, left: null}, required: page}), []);   // no count shown: nothing to compare
  assert.deepEqual(liveFailures({boxes: [], contact: CONTACT, panel: {present: false}, required: page}), []);   // no panel on the last page (a thank-you, a sign-in)
});

test('the readings line round-trips through the row\'s output', () => {
  const line = readingsLine({failures: ['ready: x'], boxes: 3});
  assert.match(line, /^live: readings: /);
  assert.deepEqual(parseReadings(`a\n${line}\nb`), {failures: ['ready: x'], boxes: 3});
  assert.equal(parseReadings('nothing'), null);
});

// What you answered yourself in a form is kept once, in the right place, and never overwrites what you already keep
// (lib/learned.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {personalKey, plan, save} from '../lib/learned.js';

test('personal facts go to Your details, only when still empty; everything else to What we learned', () => {
  const items = [{label: 'Street*', value: 'Rue du Lac 4', kind: 'text'}, {label: 'NPA', value: '1201', kind: 'text'},
    {label: 'Date of birth (dd.mm.yyyy)', value: '01.02.1990', kind: 'text'}, {label: 'Place of origin', value: 'Bern', kind: 'text'},
    {label: 'Marital status', value: 'Bachelor', kind: 'option'}, {label: 'Driving license', value: 'B', kind: 'text'}];
  const {details, answers} = plan(items, {contact: {postal_code: '1200'}});
  assert.deepEqual(details, {street: 'Rue du Lac 4', birth_date: '01.02.1990', place_of_origin: 'Bern'});  // NPA already kept: not overwritten
  assert.deepEqual(answers, [{label: 'Marital status', value: 'Bachelor'}, {label: 'Driving license', value: 'B'}]);
});

test('what the details already fill, what is known, secrets and long texts are left out', () => {
  const answered = new Set(['driving license: b']);   // the answers page's line, as save() reads it
  const {details, answers} = plan([{label: 'First name', value: 'Igor'}, {label: 'Email', value: 'a@b.test'}, {label: 'Driving license', value: 'B'},
    {label: 'Why us?', value: 'x'.repeat(301)}, {label: 'A', value: 'y'}], {answered});
  assert.deepEqual([details, answers], [{}, []]);
});

test('labels are cleaned so a line survives the Notion round trip', () => {
  assert.equal(personalKey('Postal code *'), 'postal_code');
  assert.equal(personalKey('Additional address information'), '');  // not the street
  assert.equal(plan([{label: 'Notice: period "days"', value: '30'}]).answers[0].label, 'Notice period days');
});

test('saving writes details and notes once, logs only counts, and says so; a Notion failure is reported, not thrown', async () => {
  const wrote = [];
  const stub = (storage, payload, deps) => save(storage, payload, deps);
  const storage = {secret: () => '', settings: () => ({})};  // no Notion: the reads/writes fail
  const result = await stub(storage, {host: 'api.easytemp.ch', items: [{label: 'Street', value: 'Rue du Lac 4'}]}, {notify: (...args) => wrote.push(args)});
  assert.equal(result.ok, false);
  assert.deepEqual(wrote, []);
});

test('what you typed is sorted by the shared label meanings too, any language: "Rua" is your street', async () => {
  const {plan, personalKey} = await import('../lib/learned.js');
  const aliases = [{key: 'street', phrase: 'rua'}, {key: 'first_name', phrase: 'nome próprio'}];
  const result = plan([{label: 'Rua *', value: 'Rua Augusta 12'}, {label: 'Nome próprio', value: 'Ana'}, {label: 'Disponibilidade', value: 'Imediata'}], {aliases});
  assert.deepEqual(result.details, {street: 'Rua Augusta 12'});
  assert.deepEqual(result.answers.map(answer => answer.label), ['Disponibilidade']);   // a contact field is filled from your details: never a learning
  assert.equal(personalKey('Rua'), '', 'without the shared meanings, the old words alone do not know it');
  assert.equal(personalKey('Strasse'), 'street');
});

test('an answer with Remember off is kept out of What we learned and counted as this job only (PR C)', () => {
  const {answers, jobOnly} = plan([{label: 'Driving license', value: 'B'}, {label: 'Why Acme?', value: 'The mission', remember: false}, {label: 'Notice period', value: '1 month', remember: true}]);
  assert.deepEqual(answers.map(each => each.label), ['Driving license', 'Notice period']);
  assert.deepEqual(jobOnly, [{label: 'Why Acme?', value: 'The mission'}]);
});

test('Remember starts on, and off for a question the AI says belongs to this one employer (PR C)', async () => {
  const {rememberDefaults} = await import('../lib/learned.js');
  let settings = {};
  const storage = {secret: () => '', settings: () => settings, saveSettings: next => { settings = {...settings, ...next}; }};
  const client = {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({verdicts: [
    {label: 'Notice period', verdict: 'reusable', covered_by: '', value: '', topic: 'notice period', fact: '', asks: '', country: '', sensitive: false},
    {label: 'Why do you want to join Acme?', verdict: 'one_job', covered_by: '', value: '', topic: 'why us', fact: '', asks: '', country: '', sensitive: false}]})}], usage: {}})}};
  const result = await rememberDefaults(storage, ['Notice period', 'Why do you want to join Acme?', 'Unjudged'], {client, company: 'Acme'});
  assert.deepEqual(result, {'Notice period': true, 'Why do you want to join Acme?': false, Unjudged: true});
  assert.deepEqual(await rememberDefaults(storage, ['Notice period'], {client: null}), {'Notice period': true}, 'no AI: on, as the default says');
});

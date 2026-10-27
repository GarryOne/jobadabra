// A question's kind of answer is kept with it (owner, 17 Oct 2026: "Title", "Country/Region of Residence" and a GDPR box were text fields): the fill's field type and
// options become a mark on the store's line, the same on every adapter; this Mac keeps every field's format; the AI judges old rows once, validated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as questions from '../lib/questions.js';
import * as formats from '../lib/question-formats.js';
import {keyOf} from '../renderer/question-filter.js';
import {fakeNotion} from './fake-notion.js';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
function storageWith(settings, secrets = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-formats-')), plainCrypto);
  storage.saveSettings({telemetry: false, ...settings});
  for (const [name, value] of Object.entries(secrets)) storage.setSecret(name, value);
  return storage;
}
const ADAPTERS = {
  sqlite: () => ({storage: storageWith({store: 'sqlite'}), fetcher: undefined}),
  notion: () => ({storage: storageWith({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}}, {NOTION_TOKEN: 'secret'}), fetcher: fakeNotion().fetcher}),
};
const NO = questions.NO_ANSWER;
// The owner's five live examples (17 Oct 2026), as a fill reads them.
const TRACE = [
  {label: 'Yes, I live in Switzerland, or am willing to relocate if I currently live elsewhere', type: 'checkbox', required: true, reason: NO},
  {label: 'Do you have a valid permission to work in Switzerland?', type: 'radio', options: ['Yes', 'No'], required: true, reason: NO},
  {label: 'To be eligible to work in Switzerland, please select', type: 'select', options: ['Swiss citizen', 'EU/EFTA citizen', 'Work permit', 'None'], required: true, reason: NO},
  {label: 'Title', type: 'select', options: ['Mr', 'Mrs', 'Ms'], required: true, reason: NO},
  {label: 'Country/Region of Residence', type: 'combobox', options: [], required: true, reason: NO},
  {label: 'Notice period', type: 'text', required: true, reason: NO},
];

for (const [name, make] of Object.entries(ADAPTERS)) {
  test(`${name}: a fill's question keeps its kind and options, and an answer keeps them`, async () => {
    const {storage, fetcher} = make();
    assert.equal(await questions.collect(storage, {trace: TRACE}, 'Adnovum', fetcher), TRACE.length);
    const open = await questions.list(storage, fetcher);
    const by = Object.fromEntries(open.map(q => [q.question, q]));
    assert.equal(by['Yes, I live in Switzerland, or am willing to relocate if I currently live elsewhere'].mark.kind, 'yes_no');
    assert.deepEqual(by['Do you have a valid permission to work in Switzerland?'].mark, {kind: 'single', options: ['Yes', 'No']});
    assert.deepEqual(by.Title.mark, {kind: 'single', options: ['Mr', 'Mrs', 'Ms']});
    assert.equal(by['Country/Region of Residence'].mark.kind, 'single');
    assert.equal(by['Notice period'].mark, null, 'a text question carries no mark');
    assert.equal(by.Title.company, 'Adnovum', 'the asked-by part is still read');
    // Answering keeps the mark on the line: the next screen draws the same control.
    assert.deepEqual(await questions.answer(storage, by.Title.key, 'Mr', fetcher), {ok: true});
    const groups = await questions.standardAnswers(storage, fetcher);
    const notes = groups.flatMap(group => group.items).map(item => item.answer).join('\n');
    assert.match(notes, /Title: Mr/);
    assert.doesNotMatch(notes, /\[pick one/, 'the answers the AI judges coverage against carry no mark');
    assert.ok(!(await questions.list(storage, fetcher)).some(q => q.question === 'Title'), 'answered: no longer open');
  });
}

test('this Mac keeps each field\'s format from the fill; a closed menu keeps the options read before', () => {
  const storage = storageWith({});
  formats.noteFields(storage, [{label: 'Title', type: 'select', options: ['Mr', 'Mrs']}, {label: 'text-3219', type: 'text'}, {label: 'Password', type: 'password'}, {label: 'CV', type: 'file'}]);
  assert.deepEqual(Object.values(formats.kept(storage)).map(f => [f.kind, f.options]), [['single', ['Mr', 'Mrs']]], 'no field id, password or file');
  formats.noteFields(storage, [{label: 'Title', type: 'select', options: []}]);
  assert.deepEqual(formats.keptFor(storage, 'Title').options, ['Mr', 'Mrs']);
  formats.noteFields(storage, [{label: 'Title', type: 'text'}]);
  assert.equal(formats.keptFor(storage, 'Title').kind, 'text', 'the latest fill decides the kind');
});

const fake = list => ({messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({formats: list})}], usage: {input_tokens: 1}})}});
test('the AI judges old rows once; its answer is validated', async () => {
  const storage = storageWith({});
  const labels = ['Title', 'Country/Region of Residence', 'Why us?'];
  await formats.ensure(storage, labels, {ai: {client: fake([
    {label: 'Title', kind: 'single', options: ['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof', 'Rev', 'Sir', 'Lady'], list: ''},
    {label: 'Country/Region of Residence', kind: 'single', options: ['ignored'], list: 'countries'},
    {label: 'Why us?', kind: 'essay', options: [], list: ''},
    {label: 'Invented', kind: 'text', options: [], list: ''}])}});
  const kept = formats.kept(storage);
  assert.equal(formats.keptFor(storage, 'Title').options.length, 8, 'at most 8 options');
  assert.deepEqual(formats.keptFor(storage, 'Country/Region of Residence'), {...formats.keptFor(storage, 'Country/Region of Residence'), kind: 'single', list: 'countries', options: []});
  assert.equal(formats.keptFor(storage, 'Why us?').kind, 'text', 'an unknown kind is kept as text, judged once');
  assert.equal(Object.keys(kept).length, 3, 'a label we did not ask keeps nothing');
  let calls = 0;
  await formats.ensure(storage, labels.slice(0, 2), {ai: {client: {messages: {create: async () => { calls++; return {content: []}; }}}}});
  assert.equal(calls, 0, 'judged once: no second call for the same labels');
  assert.deepEqual((await formats.ensure(storageWith({}), ['Title'])).formats, {}, 'no AI engine: nothing new');
});

test('a kind mark never becomes one of the person\'s own values (privacy tripwire)', async () => {
  const {personalValues} = await import('../lib/owner-values.js');
  const values = personalValues(['Preferred name: ❓ (asked by Acme) [pick one: Option | Another]', 'Full name: Ana Pop']);
  assert.deepEqual([...values.keys()].sort(), ['ana', 'pop']);
});

test('the AI judges a date, an amount and whether a date question also asks about constraints (validated)', async () => {
  const storage = storageWith({});
  const asked = ['What is your earliest start date, and are there any constraints we should be aware of?', 'Earliest start date', 'Expected annual salary', 'Notice period'];
  await formats.ensure(storage, asked, {ai: {client: fake([
    {label: asked[0], kind: 'date', constraints: true, options: ['x'], list: ''},
    {label: asked[1], kind: 'date', constraints: false, options: [], list: ''},
    {label: asked[2], kind: 'amount', constraints: true, options: ['ignored'], list: ''},
    {label: asked[3], kind: 'text', constraints: true, options: [], list: ''}])}});
  assert.equal(formats.keptFor(storage, asked[0]).kind, 'date');
  assert.equal(formats.keptFor(storage, asked[0]).constraints, true);
  assert.equal(formats.keptFor(storage, asked[1]).constraints, false);
  assert.equal(formats.keptFor(storage, asked[2]).kind, 'amount');
  assert.equal(formats.keptFor(storage, asked[2]).kind, 'amount');
  assert.deepEqual(formats.keptFor(storage, asked[0]).options, [], 'a date has no options');
});

test('older AI labels are rejudged with explicit calendar-day distinctions', async () => {
  const labels = ['What is your date of birth?', 'How many years of experience do you have?', 'What is your notice period?', 'When can you start?'];
  const storage = storageWith({questionFormats: Object.fromEntries(labels.map(label => [keyOf(label), {kind: 'text', options: [], list: '', constraints: false, from: 'ai', at: '2026-10-01', kinds: 3}]))});
  let request;
  const kinds = ['date', 'text', 'duration', 'text'];
  await formats.ensure(storage, labels, {ai: {client: {messages: {create: async value => {
    request = value;
    return {content: [{type: 'text', text: JSON.stringify({formats: labels.map((label, i) => ({label, kind: kinds[i], options: [], list: '', constraints: false}))})}]};
  }}}}});
  assert.match(request.system, /one exact calendar day/i);
  assert.match(request.system, /year without month\/day/i);
  assert.deepEqual(labels.map(label => formats.keptFor(storage, label).kind), kinds);
});

test('a fill\'s date field keeps the AI\'s constraints judgment, and a fill-read date is judged once for it', async () => {
  const storage = storageWith({});
  const label = 'What is your earliest start date, and are there any constraints we should be aware of?';
  formats.noteFields(storage, [{label, type: 'date'}]);
  assert.equal(formats.keptFor(storage, label).kind, 'date', 'the field type decides the kind');
  const seen = [];
  const client = {messages: {create: async request => { seen.push(request); return {content: [{type: 'text', text: JSON.stringify({formats: [{label, kind: 'text', constraints: true, options: [], list: ''}]})}]}; }}};
  await formats.ensure(storage, [label], {ai: {client}});
  assert.equal(seen.length, 1, 'asked once for the constraints');
  assert.equal(formats.keptFor(storage, label).kind, 'date', 'the AI never replaces what the fill saw');
  assert.equal(formats.keptFor(storage, label).constraints, true);
  formats.noteFields(storage, [{label, type: 'date'}]);
  assert.equal(formats.keptFor(storage, label).constraints, true, 'a later fill keeps the judgment');
  await formats.ensure(storage, [label], {ai: {client}});
  assert.equal(seen.length, 1, 'judged once');
});

test('a generic text field is semantically judged, while typed controls remain authoritative', async () => {
  const storage = storageWith({});
  const labels = ['What is your date of birth?', 'How many years of experience do you have?', 'What is your notice period?', 'Start date'];
  formats.noteFields(storage, labels.map(label => ({label, type: label === 'Start date' ? 'date' : 'text'})));
  let calls = 0;
  const kinds = ['date', 'text', 'duration', 'date'];
  const client = {messages: {create: async request => {
    calls++;
    const asked = JSON.parse(request.messages[0].content.split('\n').slice(1, -1).join('\n'));
    return {content: [{type: 'text', text: JSON.stringify({formats: asked.map(label => ({label, kind: kinds[labels.indexOf(label)], options: [], list: '', constraints: false}))})}]};
  }}};
  await formats.ensure(storage, labels, {ai: {client}});
  assert.deepEqual(labels.map(label => formats.keptFor(storage, label).kind), kinds);
  assert.equal(formats.keptFor(storage, 'Start date').from, 'fill', 'a native date control remains the source of truth');
  await formats.ensure(storage, labels, {ai: {client}});
  assert.equal(calls, 1, 'each generic text label is judged once until a new fill reports it again');
});

// Your portrait (spec 2026-10-28-your-portrait-design.md, criteria 4-7): sections appear only with their minimum evidence, the writer runs at most once a day and only
// when the evidence changed, every statement carries known evidence, sensitive facts never reach the AI, and nothing else reads the portrait. Fictional data; a counting client, no AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {PARTS, READERS, bundleOf} from '../lib/about-you.js';
import * as portrait from '../lib/portrait.js';
import {createStorage} from '../lib/storage.js';

const storage = () => {
  const made = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-portrait-')), {encrypt: v => v, decrypt: v => v});
  made.saveSettings({store: 'sqlite'});
  return made;
};
const learned = n => Array.from({length: n}, (_, at) => ({question: `Question ${at}`, answer: `Answer ${at}`, state: '', sensitive: false, kind: 'text'}));
const SOURCES = {cv: {summary: 'Platform engineer'}, details: [{label: 'Notice period', value: '3 months'}], learned: learned(5), strategy: [{label: 'Roles', value: 'SRE', group: 'roles'}]};
const bundle = (sources = SOURCES) => bundleOf(sources, 'portrait');

// A client that answers every allowed section with one cited statement, and counts its calls.
function client(extra = () => []) {
  const seen = [];
  return {seen, messages: {create: async request => {
    seen.push(request);
    const allowed = JSON.parse(request.messages[0].content.match(/<allowed_sections>(.*)<\/allowed_sections>/s)[1]);
    const sections = allowed.map(({key}) => ({key, statements: [{text: `You do ${key}.`, evidence: ['cv', 'learned:0']}]}));
    return {stop_reason: 'end_turn', usage: {input_tokens: 2000, output_tokens: 600}, content: [{type: 'text', text: JSON.stringify({sections: [...sections, ...extra(allowed)],
      letter: 'You build platforms [cv].\n\nYou answer with a concrete example first.\n\n\n  You prefer small teams.'})}]};
  }}};
}

test('a section appears only with its minimum evidence; with none, the tab is not_yet with progress', async () => {
  assert.deepEqual(portrait.qualifying(portrait.countsOf({})).map(s => s.key), []);
  assert.deepEqual(portrait.qualifying(portrait.countsOf({cv: {}})).map(s => s.key), ['short']);
  assert.deepEqual(portrait.qualifying(portrait.countsOf(bundle().parts)).map(s => s.key), ['short', 'strengths', 'looking', 'work']);
  const made = storage(), none = await portrait.status(made, {bundle: bundle({details: []})});
  assert.equal(none.state, 'not_yet');
  assert.deepEqual(none.progress.find(each => each.label === 'Form fills'), {label: 'Form fills', have: 0, need: 5});
  const ai = client();
  assert.deepEqual(await portrait.refresh(made, {client: ai, bundle: bundle({details: []})}), {ran: false, reason: 'not_yet', usd: 0});
  assert.equal(ai.seen.length, 0);
});

test('one run writes the portrait; unchanged evidence never runs again; new evidence runs at most once a day', async () => {
  const made = storage(), ai = client(), day = n => new Date(Date.UTC(2026, 9, n, 9));
  assert.equal((await portrait.refresh(made, {client: ai, bundle: bundle(), now: day(28)})).ran, true);
  assert.equal((await portrait.status(made, {bundle: bundle()})).state, 'current');
  assert.deepEqual((await portrait.refresh(made, {client: ai, bundle: bundle(), now: day(29)})).reason, 'unchanged');
  const more = bundle({...SOURCES, learned: learned(6)});
  assert.equal((await portrait.status(made, {bundle: more})).state, 'outdated');
  assert.deepEqual((await portrait.refresh(made, {client: ai, bundle: more, now: day(28)})).reason, 'today');
  assert.equal((await portrait.refresh(made, {client: ai, bundle: more, now: day(29)})).ran, true);
  assert.equal(ai.seen.length, 2);
});

test('every statement carries known evidence, a section nobody asked for is dropped, and the text reads back', async () => {
  const made = storage();
  const ai = client(() => [{key: 'personality', statements: [{text: 'You are bold.', evidence: ['cv']}]}, {key: 'work', statements: [{text: 'No source.', evidence: []}, {text: 'Wrong id.', evidence: ['learned:99']}]}]);
  await portrait.refresh(made, {client: ai, bundle: bundle(), now: new Date()});
  const shown = await portrait.status(made, {bundle: bundle()});
  assert.deepEqual(shown.sections.map(s => s.key), ['short', 'strengths', 'looking', 'work']);
  assert.ok(!JSON.stringify(shown.sections).includes('bold') && !JSON.stringify(shown.sections).includes('No source'));
  for (const section of shown.sections) for (const statement of section.statements) {
    assert.ok(statement.evidence.length, statement.text);
    for (const id of statement.evidence) assert.ok(shown.evidence[id]?.label && shown.evidence[id]?.tab, `${statement.text}: ${id}`);
  }
});

test('a failed or empty run writes nothing: the text stays as it was', async () => {
  const made = storage(), day = n => new Date(Date.UTC(2026, 9, n, 9));
  await portrait.refresh(made, {client: client(), bundle: bundle(), now: day(28)});
  const before = fs.readFileSync(made.path('portrait.md'), 'utf8');
  const broken = {messages: {create: async () => { throw new Error('Free AI is used up for today'); }}};
  await assert.rejects(portrait.refresh(made, {client: broken, bundle: bundle({...SOURCES, learned: learned(7)}), now: day(29)}), /used up/);
  const empty = {messages: {create: async () => ({stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: '{"sections":[]}'}]})}};
  await assert.rejects(portrait.refresh(made, {client: empty, bundle: bundle({...SOURCES, learned: learned(7)}), now: day(29)}), /empty/);
  assert.equal(fs.readFileSync(made.path('portrait.md'), 'utf8'), before);
});

test('sensitive and conflicting facts never reach the AI, and the prompt keeps demographics out', async () => {
  const made = storage(), ai = client();
  const sources = {...SOURCES, learned: [...learned(5), {question: 'Gender', answer: 'SENSITIVEWORD', state: '', sensitive: true, kind: 'single'},
    {question: 'Unjudged', answer: 'UNJUDGEDWORD', state: '', kind: 'text'}, {question: 'Take-home', answer: 'CONFLICTWORD', state: 'conflict', sensitive: false, kind: 'text'}]};
  await portrait.refresh(made, {client: ai, bundle: bundle(sources), now: new Date()});
  const sent = JSON.stringify(ai.seen[0]);
  for (const word of ['SENSITIVEWORD', 'UNJUDGEDWORD', 'CONFLICTWORD']) assert.ok(!sent.includes(word), word);
  assert.match(ai.seen[0].system, /criminal record/);
  assert.match(ai.seen[0].system, /never a personality type, test label/);
});

test('nothing reads the portrait: no about-you part, no reader and no other module imports it', () => {
  assert.ok(!PARTS.includes('portrait'));
  for (const [reader, rule] of Object.entries(READERS)) assert.ok(!rule.parts.includes('portrait'), reader);
  const lib = path.join(import.meta.dirname, '../lib');
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(each => (each.isDirectory() ? walk(path.join(dir, each.name)) : [path.join(dir, each.name)]));
  const readers = walk(lib).filter(file => file.endsWith('.js') && !file.endsWith('portrait.js') && !file.endsWith('portrait-handlers.js') && /from '(\.\.?\/)+(lib\/)?portrait\.js'/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(readers.map(file => path.basename(file)), [], 'only portrait-handlers.js (the tab\'s door) may import the writer');
});

test('the prompt states the case rules: contradictions stay unstated, no advice, soft skills as behaviour', async () => {
  const made = storage(), ai = client();
  await portrait.refresh(made, {client: ai, bundle: bundle(), now: new Date()});
  assert.match(ai.seen[0].system, /contradict each other .* state neither as fact/);
  assert.match(ai.seen[0].system, /Give no advice and no actions/);
  assert.match(ai.seen[0].system, /describe behaviour seen in the evidence/);
});

test('the plain letter is stored beside the statements, as clean paragraphs with no evidence ids, and reads back', async () => {
  const made = storage();
  await portrait.refresh(made, {client: client(), bundle: bundle(), now: new Date()});
  const shown = await portrait.status(made, {bundle: bundle()});
  assert.deepEqual(shown.letter, ['You build platforms.', 'You answer with a concrete example first.', 'You prefer small teams.']);
  assert.ok(!shown.letter.join(' ').includes('['));
  assert.deepEqual(shown.sections.map(s => s.key), ['short', 'strengths', 'looking', 'work']);   // the letter never becomes a section
});

test('the prompt asks for a coherent letter that adds no fact', async () => {
  const ai = client();
  await portrait.refresh(storage(), {client: ai, bundle: bundle(), now: new Date()});
  assert.match(ai.seen[0].system, /reference certificate/);
  assert.match(ai.seen[0].system, /adds no fact that is not in your statements/);
});

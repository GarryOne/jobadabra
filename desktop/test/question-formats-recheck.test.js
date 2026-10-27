// A kept AI judgment made before the current kinds existed (the salary question sorted "text" before "amount" existed, owner 17 Oct 2026) is asked again:
// once, lazily (only the labels a screen is about to show), at most 10 per call, never a form's own field type. Guarded here; the base is test/question-formats.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as formats from '../lib/question-formats.js';
import {KINDS_VERSION} from '../renderer/question-kind.js';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
const storageWith = settings => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-recheck-')), plainCrypto);
  storage.saveSettings({telemetry: false, ...settings});
  return storage;
};
// Answers "amount" for a salary label, "text" for the rest; counts calls and keeps what was sent.
function client() {
  const sent = [];
  return {sent, messages: {create: async request => {
    const labels = JSON.parse(request.messages[0].content.match(/<questions>\n([\s\S]*)\n<\/questions>/)[1]);
    sent.push({request, labels});
    return {content: [{type: 'text', text: JSON.stringify({formats: labels.map(label => ({label, kind: /salary/i.test(label) ? 'amount' : 'text', constraints: false, options: [], list: ''}))})}], usage: {input_tokens: 1}};
  }}};
}
const old = (kind, extra = {}) => ({kind, options: [], list: '', constraints: false, from: 'ai', at: '2026-10-17', ...extra});
const SALARY = 'What is your salary expectation? (In USD monthly)';

test('an unstamped AI "text" judgment is asked again once and becomes an amount; a second screen asks nothing', async () => {
  const storage = storageWith({questionFormats: {'what is your salary expectation in usd monthly': old('text'), 'city': old('text')}});
  const ai = client();
  const {formats: next} = await formats.ensure(storage, [SALARY, 'City'], {ai: {client: ai}});
  assert.equal(formats.keptFor(storage, SALARY).kind, 'amount');
  assert.equal(formats.keptFor(storage, SALARY).kinds, KINDS_VERSION, 'stamped with the kinds version');
  assert.equal(formats.keptFor(storage, 'City').kinds, KINDS_VERSION);
  assert.ok(next);
  await formats.ensure(storage, [SALARY, 'City'], {ai: {client: ai}});
  assert.equal(ai.sent.length, 1, 'asked once, never again');
});

test('only the labels shown are asked, at most 10 old ones per call; the rest wait for a later screen', async () => {
  const kept = {};
  const labels = Array.from({length: 14}, (_, n) => `Question number ${n}`);
  for (const label of labels) kept[label.toLowerCase()] = old('text');
  const storage = storageWith({questionFormats: kept});
  const ai = client();
  await formats.ensure(storage, labels, {ai: {client: ai}});
  assert.equal(ai.sent[0].labels.length, formats.RECHECK_MAX);
  await formats.ensure(storage, ['Question number 0'], {ai: {client: ai}});
  assert.equal(ai.sent.length, 1, 'a label not shown, or already re-asked, costs nothing');
});

test('a generic text field from the form can be semantically judged once; an already-stamped judgment is not re-asked', async () => {
  const storage = storageWith({questionFormats: {'start': {kind: 'text', options: [], from: 'fill', at: '2026-10-17'}, 'city': old('text', {kinds: KINDS_VERSION})}});
  const ai = client();
  await formats.ensure(storage, ['Start', 'City'], {ai: {client: ai}});
  assert.equal(ai.sent.length, 1, 'generic text needs semantic classification');
  assert.deepEqual(ai.sent[0].labels, ['Start']);
  assert.equal(formats.keptFor(storage, 'Start').kinds, KINDS_VERSION);
  await formats.ensure(storage, ['Start', 'City'], {ai: {client: ai}});
  assert.equal(ai.sent.length, 1, 'judged labels are not re-asked');
});

test('measured cost of one re-ask of 9 old questions (estimate: tokens ≈ characters / 4, Haiku $0.1 in / $0.5 out per million)', async () => {
  const labels = Array.from({length: 9}, (_, n) => `A typical application question, number ${n}?`);
  const storage = storageWith({questionFormats: Object.fromEntries(labels.map(label => [label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), old('text')]))});
  const ai = client();
  await formats.ensure(storage, labels, {ai: {client: ai}});
  const request = ai.sent[0].request;
  const input = Math.ceil((request.system.length + JSON.stringify(request.messages).length + JSON.stringify(request.output_config).length) / 4);
  const output = Math.ceil(JSON.stringify(ai.sent[0].labels.map(label => ({label, kind: 'text', constraints: false, options: [], list: ''}))).length / 4);
  const usd = (input * 0.1 + output * 0.5) / 1e6;
  console.log(`# re-ask of 9: ~${input} input + ~${output} output tokens ≈ $${usd.toFixed(5)}`);
  assert.ok(usd < 0.001, 'under a tenth of a cent');
});

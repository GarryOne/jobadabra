// A label that is a sentence asking something is a question for the AI, never read by a contact-detail word list (lib/label-shape.js; 13 Oct 2026, a pool row typed a phone number
// into "Have you automated mobile (iOS/Android) ... workflows?"). The three copies (this one, the extension's fill-labels.js and form-ready.js) agree, and the two desktop readers
// that skip contact-looking labels (lib/questions.js collect, lib/learned.js plan) use it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {createStorage} from '../lib/storage.js';
import {test} from 'node:test';
import {asksQuestion} from '../lib/label-shape.js';
import {plan} from '../lib/learned.js';
import * as questions from '../lib/questions.js';

const SAMPLES = ['Phone', 'Mobile number', 'Linkedin profile *', 'Email address', 'What is your phone number?', 'Have you automated mobile (iOS/Android) or desktop build workflows? *',
  'Do you check your e-mail for build failures every morning?', 'Is it ok?', 'Tell us a little about how you reached this point in your career so far', '', null];

test('the desktop copy, the extension\'s page copy and its worker copy say the same for every sample', async () => {
  const window = {}, context = vm.createContext({window});
  const labels = fs.readFileSync(new URL('../../extension/page/fill-labels.js', import.meta.url), 'utf8');
  // the page file needs the page kit's helpers; only its asksQuestion line is read here
  const page = new Function(`${labels.match(/const asksQuestion = .*;\n/)[0]}; return asksQuestion;`)();
  const ready = fs.readFileSync(new URL('../../extension/form-ready.js', import.meta.url), 'utf8');
  const worker = new Function(`${ready.match(/const asksQuestion = .*;\n/)[0]}; return asksQuestion;`)();
  assert.ok(context && window);
  for (const sample of SAMPLES) { assert.equal(page(sample), asksQuestion(sample), String(sample)); assert.equal(worker(sample), asksQuestion(sample), String(sample)); }
  assert.deepEqual(SAMPLES.slice(0, 5).map(asksQuestion), [false, false, false, false, true]);
  assert.equal(asksQuestion(SAMPLES[5]), true);
});

test('a sentence that names a contact detail is a question to answer, and a thing to learn, not a known contact field', async () => {
  const sentence = 'Have you automated mobile (iOS/Android) or desktop build and publication workflows?';
  const added = [];
  const fetcher = async (url, init = {}) => { if (init.method === 'PATCH') added.push(JSON.parse(init.body)); return {ok: true, json: async () => ({results: [], has_more: false})}; };
  const storage = createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
  storage.setSecret('NOTION_TOKEN', 'ntn');
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}, telemetry: false});
  const run = {trace: [{required: true, reason: questions.NO_ANSWER, label: sentence}, {required: true, reason: questions.NO_ANSWER, label: 'Mobile number'}]};
  await questions.collect(storage, run, 'Acme', fetcher).catch(() => 0);
  assert.match(JSON.stringify(added), /automated mobile/);
  assert.doesNotMatch(JSON.stringify(added), /Mobile number/);
  const result = plan([{label: sentence, value: 'Yes'}, {label: 'Mobile number', value: '+41 79 555 01 23'}]);
  assert.deepEqual(result.answers.map(answer => answer.label), [sentence]);
});

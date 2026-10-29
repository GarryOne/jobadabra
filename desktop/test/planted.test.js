// The Sentry reporter of the end-to-end journey drops only what a planted failure caused; a real error near a plant is sent; a user's install drops nothing.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {causedByPlant, PLANT_WINDOW_MS} from '../lib/planted.js';
import {create} from '../lib/sentry.js';

const E2E = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_PLANTED_FILE: '/x'};
const line = plant => `${JSON.stringify(plant)}\n`;
const AI = line({at: 99_000, why: 'ai limit', kinds: ['run_warning', 'run_failed'], text: ''});
const RECALL = line({at: 99_000, why: 'recall tiny', kinds: ['crash'], text: 'recall planted'});
const HUNG = line({at: 99_000, why: 'ai hang', kinds: ['run_failed', 'stuck'], text: ''});
const asked = (report, text, now = 100_000, env = E2E) => causedByPlant(report, env, now, () => text);

test('an extension plant hides only its own frame, even beside another error with the same safe wording', () => {
  const plant = line({at: 99_000, kinds: ['extension_error'], source: 'extension', frame: 'sentry-plant.js:17:2'});
  const report = {kind: 'extension_error', source: 'extension', message: 'Uncaught TypeError', stack: 'at sentry-plant.js:17:2'};
  assert.equal(asked(report, plant), true);
  assert.equal(asked({...report, stack: 'at fill.js:17:2'}, plant), false);
  assert.equal(asked({...report, stack: 'at other-sentry-plant.js:17:2'}, plant), false);
  assert.equal(asked({...report, source: 'window'}, plant), false);
  assert.equal(asked({...report, kind: 'crash'}, plant), false);
});

test('a report is dropped when a recent plant names its kind and its words', () => {
  assert.equal(asked({kind: 'run_warning', message: 'AI limit reached'}, AI), true);
  assert.equal(asked({kind: 'crash', message: 'Uncaught Error: recall planted error'}, RECALL), true);
  assert.equal(asked({kind: 'run_failed', message: 'src discover: stopped by the app: no output for 10 s'}, HUNG), true);
  assert.equal(asked({kind: 'run_failed', message: ''}, HUNG), true, 'a run the test stopped has no words');
});

test('a real error in the same minute as a plant is sent', () => {
  assert.equal(asked({kind: 'crash', message: 'TypeError: x is undefined'}, AI), false, 'a service plant causes run reports, not a crash');
  assert.equal(asked({kind: 'crash', message: 'TypeError: x is undefined'}, RECALL), false, 'a recall plant says "recall planted"');
  assert.equal(asked({kind: 'crash', message: 'TypeError: real bug'}, HUNG), false, 'a hung plant stops a run; it does not crash the app');
  assert.equal(asked({kind: 'fill_error', message: 'anything'}, AI), false);
});

test('an old plant, an unreadable file, a missing file and a user install drop nothing', () => {
  const report = {kind: 'run_warning', message: 'AI limit reached'};
  assert.equal(asked(report, AI, 99_000 + PLANT_WINDOW_MS + 1), false);
  assert.equal(asked(report, 'not json\n\n'), false);
  assert.equal(causedByPlant(report, E2E, 100_000, () => { throw new Error('ENOENT'); }), false);
  assert.equal(asked(report, AI, 100_000, {JOB_PILOTTO_E2E_PLANTED_FILE: '/x'}), false, 'only the journey');
  assert.equal(asked(report, AI, 100_000, {}), false, 'a user install has no planted file');
});

test('the client asks the gate with the kind and the fields, and sends a real crash next to a plant', async () => {
  const sent = [];
  const gate = (kind, fields) => !causedByPlant({kind, message: fields.message ?? fields.warning ?? ''}, E2E, 100_000, () => AI);
  const client = create({dsn: 'https://key@o1.ingest.example.test/1', release: 'r', installId: 'e2e', enabled: gate, fetcher: (url, init) => { sent.push(init.body); return Promise.resolve(); }});
  assert.equal(client.capture('run_warning', {job: 'src run', warning: 'AI limit reached'}), false, 'planted');
  assert.equal(client.capture('crash', {message: 'TypeError: real bug', stack: ''}), true, 'real, sent');
  assert.equal(sent.length, 1);
});

// The wizard harness must arm its canned AI before auto-generation and leave approval explicit.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {completeWizardLetter, wizardSetupAnswer} from '../e2e/lib/wizard.mjs';

const scenario = async ({failDraft = false, withApi = true, detailsOnly = false} = {}) => {
  const original = () => null, events = [];
  let canned = original, record = {state: 'none', pdf: false, text: ''};
  const proxy = {canned: () => canned, setCanned: fn => { canned = fn; }};
  const ctx = {proxy, expectStep: async step => { events.push(step); }, page: {
    click: async selector => {
      events.push(selector);
      if (selector === '#draft-save') {
        assert.notEqual(canned, original, 'stub must be armed before transition starts the draft');
        const details = JSON.parse(canned({output_config: {format: {schema: {properties: {proposals: {type: 'array'}}}}}}));
        assert.ok(details.proposals.length, 'strategy save retains its fictional CV details');
        assert.equal(details.letter, undefined);
        assert.deepEqual(canned({}), {refuse: 'no-credit'}, 'unknown calls never pass through');
      }
      if (selector === '#letter-start-ai') {
        if (failDraft) throw new Error('draft failed');
        if (!detailsOnly) record = {state: 'draft', pdf: false, text: JSON.parse(canned({output_config: {format: {schema: {properties: {letter: {type: 'string'}}}}}})).letter};
      }
      if (selector === '#letter-approve') {
        assert.equal(record.state, 'draft');
        record = {...record, state: 'approved', pdf: true};
      }
      if (selector === '#setup-letter-next') assert.equal(record.pdf, true);
    },
    waitForFunction: async () => {},
    evaluate: async () => record,
  }};
  if (withApi) ctx.withApi = async fn => { events.push('api-enter'); try { return await fn(); } finally { events.push('api-restore'); } };
  let error;
  try { await completeWizardLetter(ctx); } catch (caught) { error = caught; }
  assert.equal(canned, original, 'restore the suite proxy even on failure');
  return {record, events, error};
};

test('canned letter draft starts on request and is approved explicitly before continuing', async () => {
  const {record, events, error} = await scenario();
  assert.equal(error, undefined);
  assert.ok(record.text);
  assert.deepEqual(events, ['api-enter', '#draft-save', 'letter', '#letter-start-ai', '#letter-approve', '#setup-letter-next', 'api-restore']);
});

test('failure restores the proxy and never approves or continues', async () => {
  const {events, error} = await scenario({failDraft: true});
  assert.match(error.message, /draft failed/);
  assert.deepEqual(events, ['api-enter', '#draft-save', 'letter', '#letter-start-ai', 'api-restore']);
});

test('a missing dummy-key seam is refused before generation', async () => {
  const {events, error} = await scenario({withApi: false});
  assert.match(error.message, /requires the canned API seam/);
  assert.deepEqual(events, []);
});


test('a CV-details reply cannot count as the letter draft', async () => {
  const {error, events} = await scenario({detailsOnly: true});
  assert.match(error.message, /did not use the canned letter/);
  assert.equal(events.includes('#letter-approve'), false);
});

test('the CV details response remains distinct and usable by its actual proposal cleaner', async () => {
  const {cleanProposals} = await import('../lib/contact-from-cv.js');
  const cv = {name: 'Alex Example', location: 'Zurich, Switzerland'};
  const body = {output_config: {format: {schema: {properties: {proposals: {type: 'array'}}}}}};
  const reply = JSON.parse(wizardSetupAnswer(body, {cv, letter: 'fictional letter'}));
  const proposals = cleanProposals(reply.proposals, ['first_name', 'last_name', 'location']);
  assert.deepEqual(proposals, [
    {field: 'first_name', value: 'Alex', sure: true},
    {field: 'last_name', value: 'Example', sure: true},
    {field: 'location', value: 'Zurich, Switzerland', sure: true},
  ]);
  assert.deepEqual(wizardSetupAnswer({output_config: {format: {schema: {properties: {score: {}}}}}}, {cv, letter: 'fictional letter'}), {refuse: 'no-credit'});
});

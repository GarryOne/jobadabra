// The wizard harness must arm its canned AI before auto-generation and leave approval explicit.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {completeWizardLetter} from '../e2e/lib/wizard.mjs';

const scenario = async ({failDraft = false, engine = 'api'} = {}) => {
  const original = () => null, events = [];
  let canned = original, record = {state: 'none', pdf: false, text: ''};
  const proxy = {canned: () => canned, setCanned: fn => { canned = fn; }};
  const ctx = {engine, proxy, expectStep: async step => { events.push(step); }, page: {
    click: async selector => {
      events.push(selector);
      if (selector === '#draft-save') {
        assert.notEqual(canned, original, 'stub must be armed before transition starts the draft');
        if (failDraft) throw new Error('draft failed');
        record = {state: 'draft', pdf: false, text: JSON.parse(canned({})).letter};
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
  let error;
  try { await completeWizardLetter(ctx); } catch (caught) { error = caught; }
  assert.equal(canned, original, 'restore the suite proxy even on failure');
  return {record, events, error};
};

test('canned auto-draft is approved explicitly before continuing', async () => {
  const {record, events, error} = await scenario();
  assert.equal(error, undefined);
  assert.ok(record.text);
  assert.deepEqual(events, ['#draft-save', 'letter', '#letter-approve', '#setup-letter-next']);
});

test('failure restores the proxy and never approves or continues', async () => {
  const {events, error} = await scenario({failDraft: true});
  assert.match(error.message, /draft failed/);
  assert.deepEqual(events, ['#draft-save']);
});

test('engines bypassing the stub are refused before generation', async () => {
  const {events, error} = await scenario({engine: 'cli'});
  assert.match(error.message, /requires the canned API proxy/);
  assert.deepEqual(events, []);
});

// The wizard harness answers fictional CV details while saving strategy; letter drafting belongs to Settings.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {saveWizardStrategy, wizardSetupAnswer} from '../e2e/lib/wizard.mjs';

const scenario = async ({failSave = false, withApi = true} = {}) => {
  const original = () => null, events = [];
  let canned = original;
  const proxy = {canned: () => canned, setCanned: fn => { canned = fn; }};
  const ctx = {proxy, page: {
    locator: selector => ({isVisible: async () => { events.push(selector); return true; }}),
    click: async selector => {
      events.push(selector);
      assert.equal(selector, '#draft-save');
      assert.notEqual(canned, original, 'stub is armed before strategy save starts its CV-details request');
      const details = JSON.parse(canned({output_config: {format: {schema: {properties: {proposals: {type: 'array'}}}}}}));
      assert.ok(details.proposals.length, 'strategy save retains its fictional CV details');
      assert.equal(details.letter, undefined);
      assert.deepEqual(canned({}), {refuse: 'no-credit'}, 'unknown calls never pass through');
      if (failSave) throw new Error('save failed');
    },
  }};
  if (withApi) ctx.withApi = async fn => { events.push('api-enter'); try { return await fn(); } finally { events.push('api-restore'); } };
  let error;
  try { await saveWizardStrategy(ctx); } catch (caught) { error = caught; }
  assert.equal(canned, original, 'restore the suite proxy even on failure');
  return {events, error};
};

test('strategy save answers CV details without generating or approving a letter', async () => {
  const {events, error} = await scenario();
  assert.equal(error, undefined);
  assert.deepEqual(events, ['api-enter', '#draft-save', '#finish', 'api-restore']);
});

test('failure restores the proxy without continuing', async () => {
  const {events, error} = await scenario({failSave: true});
  assert.match(error.message, /save failed/);
  assert.deepEqual(events, ['api-enter', '#draft-save', 'api-restore']);
});

test('a missing dummy-key seam is refused before saving', async () => {
  const {events, error} = await scenario({withApi: false});
  assert.match(error.message, /requires the canned API seam/);
  assert.deepEqual(events, []);
});

test('the CV details response remains distinct and usable by its actual proposal cleaner', async () => {
  const {cleanProposals} = await import('../lib/contact-from-cv.js');
  const cv = {name: 'Alex Example', location: 'Zurich, Switzerland'};
  const body = {output_config: {format: {schema: {properties: {proposals: {type: 'array'}}}}}};
  const reply = JSON.parse(wizardSetupAnswer(body, {cv}));
  const proposals = cleanProposals(reply.proposals, ['first_name', 'last_name', 'location']);
  assert.deepEqual(proposals, [
    {field: 'first_name', value: 'Alex', sure: true},
    {field: 'last_name', value: 'Example', sure: true},
    {field: 'location', value: 'Zurich, Switzerland', sure: true},
  ]);
  assert.deepEqual(wizardSetupAnswer({output_config: {format: {schema: {properties: {score: {}}}}}}, {cv}), {refuse: 'no-credit'});
});

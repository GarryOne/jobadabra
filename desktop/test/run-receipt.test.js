// A confirmed submit is stamped on the fill's run row, the same row in every Apply mode (the extension logs the fill through /extension/run in the visible and the hidden browser alike).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {extensionStore} from '../lib/store/extension-store.js';

const JOB = 'https://jobs.example.test/acme/1';
const OLD = {id: 'old', url: JOB, outcome: 'Ready', fields: {job: 'SRE', status: 'Ready', field_count: 4, data: {fields: [{label: 'Name'}]}}};
const NEW = {id: 'new', url: JOB, outcome: 'Ready', fields: {job: 'SRE', status: 'Ready', field_count: 9, data: {fields: [{label: 'Name'}, {label: 'Why us?'}]}}};
const OTHER = {id: 'other', url: 'https://jobs.example.test/zed/2', outcome: 'Ready', fields: {}};

function storeOf(rows) {
  const updated = [];
  const call = async (_, entity, method, kwargs) => {
    if (entity === 'agent_runs' && method === 'list') return rows;   // newest first, as the store lists
    if (entity === 'agent_runs' && method === 'update') { updated.push(kwargs); return {id: kwargs.run_id}; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  return {store: extensionStore({}, {call}), updated};
}

test('the receipt lands on the latest run row of that job and keeps what the fill recorded', async () => {
  const {store, updated} = storeOf([OTHER, NEW, OLD]);
  assert.deepEqual(await store.receiptRun(JOB, '2026-10-29T01:00:00.000Z'), {ok: true, id: 'new'});
  assert.equal(updated.length, 1);
  assert.equal(updated[0].run_id, 'new', 'the newest row of this job, not an older fill or another job');
  const row = updated[0].fields;
  assert.equal(row.outcome, 'Submitted');
  assert.equal(row.fields.status, 'Submitted');
  assert.equal(row.fields.job_stage, 'Applied');
  assert.equal(row.fields.data.submitted_at, '2026-10-29T01:00:00.000Z');
  assert.equal(row.fields.field_count, 9, 'the fill\'s own numbers stay');
  assert.deepEqual(row.fields.data.fields, NEW.fields.data.fields, 'the trace stays');
});

test('a job with no fill row gets no row made up for it', async () => {
  const {store, updated} = storeOf([OTHER]);
  assert.deepEqual(await store.receiptRun(JOB, '2026-10-29T01:00:00.000Z'), {ok: false, skipped: true});
  assert.deepEqual(updated, []);
});

test('a row logged under the extension\'s own URL is found by the job key when the list\'s URL differs', async () => {
  const row = {id: 'q', url: 'https://job-boards.greenhouse.io/acme/jobs/5114768008?gh_src=abc', outcome: 'Ready', fields: {job: 'SRE'}};
  const {store, updated} = storeOf([OTHER, row]);
  assert.deepEqual(await store.receiptRun('https://job-boards.greenhouse.io/acme/jobs/5114768008', '2026-10-29T01:00:00.000Z'), {ok: true, id: 'q'});
  assert.equal(updated[0].run_id, 'q');
});

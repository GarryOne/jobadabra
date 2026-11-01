// A job started in this session must not be "picked up from before you quit": the queue is read at launch, not when the 20-second timer fires.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import {scheduleResume} from '../lib/resume-queue.js';

const store = initial => { const files = {'queue.json': JSON.stringify(initial)}; return {files, readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }}; };
const job = (kind, trigger = 'you') => ({kind, trigger, queuedAt: 'x', resume: {mode: 'run'}});

test('only what was running when the app last quit is started again, not what you start after launch', () => {
  const storage = store([job('insight')]);
  let fire, begun;
  const taken = scheduleResume(pipeline, storage, {begin: jobs => { begun = jobs; }, timer: callback => { fire = callback; }});
  assert.deepEqual(taken.map(item => item.kind), ['insight']);
  assert.equal(storage.files['queue.json'], '[]');   // taken at launch
  storage.files['queue.json'] = JSON.stringify([job('search')]);   // the person presses Run within the 20 seconds: the running job is saved
  fire();
  assert.deepEqual(begun.map(item => item.kind), ['insight']);   // not the search that was started after launch
});

test('a schedule\'s own jobs are not started again, and neither are searches and Gmail checks when Always on runs them', () => {
  const kept = scheduleResume(pipeline, store([job('search', 'schedule'), job('mail'), job('insight')]), {cloud: true, begin: () => {}, timer: () => {}});
  assert.deepEqual(kept.map(item => item.kind), ['insight']);
});

// The journey shortens the 20-second wait before the jobs of the last session start again, so the quit-in-the-middle test does not sit through it (JOBADABRA_E2E_RESUME_MS).
import {resumeDelay} from '../lib/resume-queue.js';
test('the resume wait is 20 s for a user, and shortened only in the end-to-end journey', () => {
  assert.equal(resumeDelay({}), 20000);
  assert.equal(resumeDelay({JOBADABRA_E2E_RESUME_MS: '3000'}), 20000, 'a user never gets it');
  assert.equal(resumeDelay({JOBADABRA_E2E: '1', JOBADABRA_E2E_RESUME_MS: '3000'}), 3000);
  assert.equal(resumeDelay({JOBADABRA_E2E: '1', JOBADABRA_E2E_RESUME_MS: 'soon'}), 20000);
});

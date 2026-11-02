// Owner, 7 Oct 2026: a task that was running when the app quit is listed as Interrupted with its log and its Notion row, even when it can be
// started again, and the app asks before starting it again ("Start again" / "Leave stopped") instead of doing it by itself.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import {askResume, resumeQuestion} from '../lib/resume-queue.js';
import {failureHead} from '../renderer/run-status.js';

test('quit during a task that can be started again: Interrupted with its log and row, and handed back to ask about', async () => {
  const files = {};
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: name => `/tmp/${name}`,
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
  // A tracked task like Find new employers, with the line that names its Notion row and a progress line.
  let finish;
  pipeline.work(storage, 'scout', () => {}, async tee => {
    tee('Cronjob run logged: https://app.notion.com/p/run-row-123');
    tee('Scout: checked 4 of 91: Würth AG');
    await new Promise(resolve => { finish = resolve; });
    return true;
  });
  for (let waited = 0; !finish && waited < 2000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(finish, 'setup: the task is running');
  // work() has no resume command; give the saved job one, as task() does for the engine's commands.
  pipeline.freezeQueue(storage);
  const saved = JSON.parse(files['queue.json']);
  files['queue.json'] = JSON.stringify(saved.map(job => ({...job, resume: {args: ['src', 'scout']}})));
  const again = pipeline.takeQueue(storage);
  assert.deepEqual(again.map(job => job.kind), ['scout'], 'handed back, to ask about');
  const row = pipeline.runs(storage)[0];
  assert.equal(row.interrupted, true);
  assert.equal(row.notionUrl, 'https://app.notion.com/p/run-row-123', 'the same row as Notion\'s: listed once');
  assert.ok(row.log.includes('Scout: checked 4 of 91: Würth AG'), 'what it said before the quit is kept');
  assert.equal(failureHead(row, 'Find new employers').title, 'Find new employers was interrupted', 'not "stopped unexpectedly"');
  finish();
});

test('the app asks before starting again; the end-to-end journey answers by its setting', async () => {
  const asked = [];
  const ask = answer => async options => { asked.push(options); return {response: answer}; };
  assert.deepEqual(await askResume(['Find new employers'], {ask: ask(0), env: {}}), {start: true, decidedBy: 'you'});
  assert.deepEqual(await askResume(['Find new employers'], {ask: ask(1), env: {}}), {start: false, decidedBy: 'you'});
  assert.deepEqual(asked[0].buttons, ['Start again', 'Leave stopped']);
  assert.equal(resumeQuestion(['Refresh jobs', 'Find new employers']).message, 'Start Refresh jobs and Find new employers again?');
  assert.deepEqual(await askResume(['Refresh jobs'], {ask: () => { throw new Error('no dialog in e2e'); }, env: {JOBADABRA_E2E: '1'}}), {start: true, decidedBy: 'e2e'});
  assert.deepEqual(await askResume(['Refresh jobs'], {env: {JOBADABRA_E2E: '1', JOBADABRA_E2E_RESUME: 'leave'}}), {start: false, decidedBy: 'e2e'});
  assert.deepEqual(await askResume([], {env: {}}), {start: false, decidedBy: 'nothing to ask'});
});

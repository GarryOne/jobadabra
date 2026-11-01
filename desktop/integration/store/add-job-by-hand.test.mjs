// Layer 3 (Node + the real engine, no window): "Applied elsewhere": a person adds a job they applied to outside the app, or one a recruiter sent first, and it lands once in the store.
// Job: serve stored answers
// Why (1 Nov 2026, owner: "We can build 10-20 more journeys. for the integrations"; Trello journey 13 "Add jobs, outside applications and recruiter messages" had only a source-text unit test):
// the app's own task code (pipeline.addApplied) runs the real engine on a temp install; the AI is the kit's proxy, which refuses every call, and the engine's own "AI stages skipped" line
// is the valid end: tracking never waits for the AI. Rows are read through the engine's own commands, never hand-written.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {startEngineKit} from './engine-kit.mjs';

let kit;
before(async () => { kit = await startEngineKit(); });
after(async () => { await kit?.close(); });

const details = (title, company, extra = {}) => ({title, company, text: `${company} is hiring a ${title}. Python, Kubernetes, Terraform.`, ...extra});

/** The add, to its end: the app's one call, then the kit quiet (a finished add may start a quiet follow-up step). */
async function addApplied(url, when, info) {
  const lines = [];
  const result = await kit.tasks.addApplied(kit.storage, url, when, line => lines.push(String(line)), info);
  await kit.settled();
  return {result, lines};
}

const applicationsAt = async url => (await kit.data('applications', 'list', {})).filter(row => row.url === url);
const eventsOf = async id => (await kit.data('events', 'list', {})).filter(event => event.app_id === id);
const jobsAt = async url => (await kit.tasks.jobs(kit.storage)).jobs.filter(job => job.url === url);

test('A job applied to elsewhere: it is in the store once as Applied with its date and in the Jobs list as Applied, and adding the same link again adds nothing', async () => {
  const url = 'https://jobs.example.test/acme/sre-1';
  const first = await addApplied(url, '2026-10-20', details('Site Reliability Engineer', 'Acme Probe'));
  assert.equal(first.result.ok, true, `the add failed: ${first.result.text}`);
  assert.equal(first.result.job.created, true, 'the first add must create the job');
  assert.match(first.result.text, /Tracked: Site Reliability Engineer — Acme Probe, applied 2026-10-20/, 'the person is told what was recorded, in words');

  const rows = await applicationsAt(url);
  assert.equal(rows.length, 1, 'one Applications row for the link');
  assert.deepEqual([rows[0].title, rows[0].company, rows[0].stage, rows[0].applied_on, rows[0].origin], ['Site Reliability Engineer', 'Acme Probe', 'Applied', '2026-10-20', 'Outbound']);
  assert.equal(rows[0].source, 'Jobadabra app', 'a job added in the app says the app, not Telegram (#2909)');
  const events = await eventsOf(rows[0].id);
  assert.deepEqual(events.map(event => [event.kind, event.at, event.source]), [['Applied', '2026-10-20', 'Jobadabra app']], 'one Applied event on the date the person gave, from the app');
  const listed = await jobsAt(url);
  assert.equal(listed.length, 1, 'the Jobs list holds the job once');
  assert.deepEqual([listed[0].status, listed[0].stage, listed[0].company], ['applied', 'Applied', 'Acme Probe']);

  const again = await addApplied(url, '2026-10-20', details('Site Reliability Engineer', 'Acme Probe'));
  assert.equal(again.result.ok, true, `the second add failed: ${again.result.text}`);
  assert.equal(again.result.job.created, false, 'the same link is not created twice');
  assert.equal(again.result.job.pageId, first.result.job.pageId, 'the second add answers with the same job');
  assert.equal((await applicationsAt(url)).length, 1, 'still one Applications row');
  assert.equal((await eventsOf(rows[0].id)).length, 1, 'still one Applied event');
  assert.equal((await jobsAt(url)).length, 1, 'still one job in the list');
});

test('A recruiter who wrote first: the job is added as Applied and Inbound, once, with its own Applied event', async () => {
  const url = 'https://jobs.example.test/beta/platform-2';
  const added = await addApplied(url, '2026-10-21', details('Platform Engineer', 'Beta Probe', {origin: 'inbound'}));
  assert.equal(added.result.ok, true, `the add failed: ${added.result.text}`);
  const rows = await applicationsAt(url);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].stage, rows[0].origin, rows[0].applied_on], ['Applied', 'Inbound', '2026-10-21']);
  assert.deepEqual((await eventsOf(rows[0].id)).map(event => event.kind), ['Applied']);
  const listed = await jobsAt(url);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].origin, 'Inbound', 'the Jobs list says the recruiter wrote first');
});

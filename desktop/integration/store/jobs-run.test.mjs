// Layer 3 (Node + the real engine + a temp store, no window): two steps of the e2e `jobs` suite, moved here on 1 Nov 2026 (R2). "Find new employers probes the seed company and lists it in the store"
// and "a slow Jobs check ends cleanly". The window side of the second (the running banner and the Technical log while a slow check works) is screen-cardstates' mocked live run
// (integration/app); what stays only in after-merge e2e is the real window watching a real 35-minute-shaped check. Data comes from the engine's own commands, never hand-written rows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {assertNothingRunning, commonProblems, whatARunShows} from './engine-support.mjs';
import {startEngineKit} from './engine-kit.mjs';

const E2E = new URL('../../e2e/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let kit;
before(async () => { kit = await startEngineKit({answers: 'jobs'}); });
after(async () => { await kit?.close(); });

test('Find new employers probes the seed company and lists it in the store (Employers & Sources)', async () => {
  fs.copyFileSync(path.join(E2E, 'fixtures', 'feeds', 'scout_seeds.json'), path.join(kit.profile, 'config', 'scout_seeds.json'));
  const done = await kit.runTask('scout', 'you');
  assert.ok(done.ok !== false, `the finder did not end: ${JSON.stringify(done).slice(0, 300)}`);
  const listed = [...((await kit.data('employers', 'list', {active: false})) || []), ...((await kit.data('employers', 'list', {})) || [])].find(employer => employer.name === 'E2E Gamma');   // active or not
  assert.ok(listed, '"E2E Gamma" was not listed in the store (Employers & Sources) after the finder ended');
  await assertNothingRunning(kit);
});

test('a slow Jobs check ends cleanly: the newest run is finished and ok, nothing is left Not scored, nothing runs on', async () => {
  // Four new matching postings appear and every AI call is slow: the shape of a friend's 35-minute check (2 Oct 2026). The delay is short here: what must hold at the end does not depend on how slow.
  const acme = JSON.parse(fs.readFileSync(path.join(E2E, 'fixtures', 'feeds', 'acme.json'), 'utf8'));
  const more = ['Senior Site Reliability Engineer, Payments', 'Staff Platform Engineer, Observability', 'Senior DevOps Engineer, Cloud', 'Senior Infrastructure Engineer, Kubernetes'];
  more.forEach((title, i) => acme.jobs.push({id: 1100 + i, title, location: {name: 'Zurich, Switzerland'}, absolute_url: `https://boards.e2e.test/job/${1100 + i}`, updated_at: '2026-10-02T09:00:00Z',
    content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, hybrid in Zurich, English working language.</p>`}));
  fs.writeFileSync(path.join(kit.feeds, 'acme.json'), JSON.stringify(acme));
  kit.proxy.setDelay(400);
  const calls = kit.proxy.stats.calls;
  let done;
  try { done = await kit.runTask('refresh', 'run', 'you'); } finally { kit.proxy.setDelay(0); }
  assert.ok(kit.proxy.stats.calls > calls, 'the test never reached the slow AI path (no AI call went through the proxy)');
  const seen = await whatARunShows(kit, done, {mode: 'run'});
  assert.deepEqual(commonProblems(kit, seen), []);
  assert.ok(seen.app.ok && !seen.app.live, `the task ended but the newest run is ${seen.app.live ? 'still live' : 'failed'}: ${seen.app.result}`);
  const matches = (await kit.data('matches', 'list', {})) || [];
  const unscored = matches.filter(job => /^E2E /.test(job.company || '') && (job.fit == null || job.fit === ''));
  assert.deepEqual(unscored.map(job => job.title), [], 'jobs are still "Not scored" after the task ended');
  for (const title of more) assert.ok(matches.some(job => job.title === title), `the new posting "${title}" never reached the Jobs list`);
  await assertNothingRunning(kit);
});

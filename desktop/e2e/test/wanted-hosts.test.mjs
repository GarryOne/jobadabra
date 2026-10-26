// Usage-weighted pool, step 3 (lib/wanted-hosts.mjs): the hosts real users apply on that the pool lacks become discovery candidates, from the loaded profile's jobs and
// only on this Mac. A suggested host with no posting among them is listed, never skipped silently, and nothing here ever reaches the public smoke-sites.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {candidates} from '../lib/record-sites.mjs';
import {fetchWanted, wantedFirst} from '../lib/wanted-hosts.mjs';

const answer = sites => ({ok: true, json: async () => ({next: {sites}})});
const site = (host, installs = 5) => ({host, installs, uses: installs, countries: [{country: 'md', installs}]});

test('the suggested hosts come from the site with the owner key, and only plain, visitable hosts are kept', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, init.headers.Authorization]); return answer([site('careers.acme.md'), site('www.linkedin.com'), site('acme.md/jobs?x=1'), site('jobs.indeed.com'), site('hr.unic.md')]); };
  const got = await fetchWanted({env: {}, key: 'k', fetcher});
  assert.deepEqual(got.hosts.map(item => item.host), ['careers.acme.md', 'hr.unic.md']);
  assert.deepEqual(calls, [['https://www.jobpilotto.top/admin/form-filling/lab?json', 'Bearer k']]);
});

test('nothing is asked on CI, a control run or without a key', async () => {
  const fetcher = async () => { throw new Error('must not be called'); };
  assert.deepEqual((await fetchWanted({env: {CI: '1'}, key: 'k', fetcher})).hosts, []);
  assert.deepEqual((await fetchWanted({env: {REAL_EXTENSION_DIR: '/x'}, key: 'k', fetcher})).hosts, []);
  assert.deepEqual((await fetchWanted({env: {}, key: '', fetcher})).hosts, []);
  assert.match((await fetchWanted({env: {}, key: 'k', fetcher})).why, /not asked|failed/);   // a failing site never fails a run
});

test('postings on a wanted host come first (a few each), the rest keep their order; a wanted host with no posting is listed', () => {
  const posting = (host, n) => ({url: `https://${host}/job/${n}`, company: host});
  const jobs = [posting('a.example.com', 1), posting('careers.acme.md', 1), posting('careers.acme.md', 2), posting('careers.acme.md', 3), posting('b.example.com', 1), posting('hr.unic.md', 1)];
  const wanted = [{host: 'careers.acme.md'}, {host: 'jobs.moldcell.md'}, {host: 'hr.unic.md'}];
  const {chosen, missing} = wantedFirst(jobs, wanted, new Set());
  assert.deepEqual(chosen.map(item => item.url), ['https://careers.acme.md/job/1', 'https://careers.acme.md/job/2', 'https://careers.acme.md/job/3', 'https://hr.unic.md/job/1',
    'https://a.example.com/job/1', 'https://b.example.com/job/1']);
  assert.deepEqual(missing, ['jobs.moldcell.md']);
  assert.deepEqual(wantedFirst(jobs, [], new Set()).chosen, candidates(jobs, new Set()));   // no suggestion: the old order and rule
});

test('a posting already in the pool is not a candidate, and discovery writes the repo\'s pool list (CI runs every row), never a Mac\'s extra list', () => {
  const jobs = [{url: 'https://careers.acme.md/job/1', company: 'x'}];
  assert.deepEqual(wantedFirst(jobs, [{host: 'careers.acme.md'}], new Set(['https://careers.acme.md/job/1'])).chosen, []);
  const source = fs.readFileSync(new URL('../record-sites.mjs', import.meta.url), 'utf8');
  assert.match(source, /writeFileSync\(POOL_SITES\b/, 'a discovered shape goes into desktop/e2e/smoke-sites.json');
  assert.ok(!/writeFileSync\(LOCAL_SITES\b/.test(source), 'a Mac\'s extra list is read, never written');
});

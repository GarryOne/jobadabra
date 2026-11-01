// The daily discovery batch's picker (lib/discovery-pick.mjs): four signals, best first, never a host already recorded, never above the week's cap.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAX_ROWS, budget, pickBatch, weekOf} from '../../lib/discovery-pick.mjs';

const NOW = new Date('2026-10-17T06:00:00Z');   // a Saturday; its week starts Monday 12 Oct
const posting = (host, path = '/jobs/1', source = 'matches', installs = 1) => ({url: `https://${host}${path}`, host, source, installs});
const pool = [{shape: 'Lever row', urls: ['https://jobs.lever.co/a/1']}, {shape: 'Ashby row', urls: ['https://jobs.ashbyhq.com/b/2']}, {shape: 'Greenhouse row', urls: ['https://boards.greenhouse.io/c/3']}];
const hosts = result => result.rows.map(row => new URL(row.urls[0]).hostname);

test('each signal picks its own kind of row, best first, one host once', () => {
  const input = {
    candidates: [posting('jobs.elastic.co'), posting('jobs.elastic.co', '/jobs/2'), posting('www.mongodb.com'), posting('careers.stuck.example', '/j/9', 'applying'),
      posting('career5.successfactors.eu', '/j/1', 'matches', 2), posting('jobs.ashbyhq.com', '/other/5')],
    misses: [{platform: 'SuccessFactors', cause: 'ai_declined', lost: 8, forms: 2}],
    demand: [{platform: 'Ashby', share: 60}, {platform: 'Lever', share: 3}, {platform: 'Greenhouse', share: 20}],
  };
  const out = pickBatch({input, pool, now: NOW});
  assert.deepEqual(out.rows.map(row => row.source), ['misses', 'applying', 'matches', 'gaps', 'matches']);
  assert.deepEqual(hosts(out), ['career5.successfactors.eu', 'careers.stuck.example', 'jobs.elastic.co', 'jobs.ashbyhq.com', 'www.mongodb.com']);
  assert.equal(out.rows[0].shape, 'Discovery: career5.successfactors.eu');
  assert.match(out.rows[0].why, /lost 8 required questions/);
});

test('a host in the pool or recorded by an earlier batch is never picked again, and a known ATS tenant is no new shape', () => {
  const input = {candidates: [posting('jobs.lever.co', '/a/9'), posting('www.mongodb.com'), posting('boards.greenhouse.io', '/c/1'), posting('jobs.elastic.co')]};
  const out = pickBatch({input, pool, seen: [{url: 'https://jobs.elastic.co/jobs/1', reached: 'form'}], now: NOW});
  assert.deepEqual(hosts(out), ['www.mongodb.com'], 'the Lever and Greenhouse companies are in the pool, elastic was recorded, and matches only picks company sites');
  const other = pickBatch({input: {candidates: [posting('jobs.lever.co', '/other-co/9')], demand: [{platform: 'Lever', share: 80}]}, pool, now: NOW});
  assert.deepEqual(hosts(other), ['jobs.lever.co'], 'another company on a recorded platform is a new site');
});

test('a stuck application is picked whatever its platform; a gap is not, when every recorded row of the platform met a bot wall', () => {
  const input = {candidates: [posting('jobs.smartrecruiters.com', '/A/1'), posting('career.example.org', '/j/1', 'applying'), posting('jobs.lever.co', '/x/1', 'applying')],
    demand: [{platform: 'SmartRecruiters', share: 60}]};
  const walled = [...pool, {shape: 'SR', urls: ['https://jobs.smartrecruiters.com/Nexthink/1'], signature: 'posting@jobs.smartrecruiters.com#code/bot'}];
  const out = pickBatch({input, pool: walled, now: NOW});
  assert.deepEqual(hosts(out), ['career.example.org', 'jobs.lever.co'], 'a stuck Lever application of a company not in the pool is picked; smartrecruiters is walled');
  const open = pickBatch({input: {...input, candidates: [posting('boards.smartrecruiters.com', '/B/2')]}, pool: walled, now: NOW});
  assert.deepEqual(open.rows, []);
  assert.match(open.skipped[0].why, /bot wall/);
});

test('never above five rows, and a signal with no posting is said, not skipped silently', () => {
  const candidates = Array.from({length: 12}, (_, n) => posting(`site${n}.example.org`));
  assert.equal(pickBatch({input: {candidates}, pool, now: NOW}).rows.length, MAX_ROWS);
  const none = pickBatch({input: {candidates: [], misses: [{platform: 'Workday', cause: 'x', lost: 3}]}, pool, now: NOW});
  assert.deepEqual(none.rows, []);
  assert.match(none.skipped[0].why, /Workday: no posting/);
});

test('the week\'s cap counts the batch\'s own spend lines, from Monday; at the cap no rows, said once', () => {
  assert.equal(weekOf('2026-10-17'), '2026-10-12');
  assert.equal(weekOf('2026-10-18'), '2026-10-12');
  assert.equal(weekOf('2026-10-19'), '2026-10-19');
  const spends = [{at: '2026-10-11T06:00:00Z', usd: 2.9}, {at: '2026-10-13T06:00:00Z', usd: 1.5}, {at: '2026-10-14T06:00:00Z', usd: 1.2}];
  assert.deepEqual(budget(spends, NOW), {week: '2026-10-12', spent: 2.7, remaining: 0.3, rows: 5}, 'last week\'s line is not counted');
  assert.equal(budget([...spends, {at: '2026-10-15T06:00:00Z', usd: 0.28}], NOW).rows, 0);
  const candidates = [posting('a.example.org')];
  const capped = pickBatch({input: {candidates}, pool, now: NOW, spends: [...spends, {at: '2026-10-15T06:00:00Z', usd: 0.28}]});
  assert.equal(capped.capped, true);
  assert.deepEqual(capped.rows, []);
  assert.equal(pickBatch({input: {candidates}, pool, now: NOW, spends: [{at: '2026-10-14T06:00:00Z', usd: 2.85}]}).rows.length, 1, 'the cap pays for the rows it can: $0.15 left = 2 rows, one candidate');
});

test('a host the run may never visit is never picked', () => {
  const out = pickBatch({input: {candidates: [posting('www.linkedin.com', '/jobs/view/1'), posting('careers.fine.example')]}, pool, now: NOW});
  assert.deepEqual(hosts(out), ['careers.fine.example']);
});

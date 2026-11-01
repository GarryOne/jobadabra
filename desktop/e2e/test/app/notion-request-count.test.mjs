// Request counts describe HTTP traffic without retaining ids, query values or applicant data.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createNotionRequestCount, countNotionRequestsByStep} from '../../lib/notion-request-count.mjs';

test('request artifacts group methods and UUID route shapes with elapsed arrival times', () => {
  let now = 1000;
  const count = createNotionRequestCount({clock: () => now});
  assert.deepEqual(count.snapshot(), {v: 1, total: 0, firstMs: null, lastMs: null, byRoute: {}});
  now = 1012;
  count.record({method: 'POST', url: '/v1/pages'});
  now = 1040;
  count.record({method: 'GET', url: '/v1/blocks/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/children?page_size=100'});
  now = 1060;
  count.record({method: 'GET', url: '/v1/blocks/11111111222233334444555555555555/children?start_cursor=secret'});
  now = 1080;
  count.record({method: 'GET', url: '/files/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'});
  count.record({method: 'GET', url: '/v1/users/me'});
  count.record({method: 'DELETE', url: '/v1/blocks/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'});
  count.record({method: 'POST', url: '/v1/search'});
  const saved = JSON.parse(JSON.stringify(count.snapshot()));
  assert.deepEqual(saved, {v: 1, total: 7, firstMs: 12, lastMs: 80, byRoute: {
    'POST /v1/pages': 1, 'GET /v1/blocks/:id/children': 2, 'GET /files/:id': 1,
    'GET /v1/users/me': 1, 'DELETE /v1/blocks/:id': 1, 'POST /v1/search': 1,
  }});
  count.record({method: 'POST', url: '/v1/pages'});
  assert.equal(saved.total, 7, 'a snapshot is detached from subsequent traffic');
});

test('step results keep request deltas on success and failure without counting setup or filtered steps', async () => {
  const count = createNotionRequestCount();
  const request = () => count.record({method: 'GET', url: '/v1/users/me'});
  const runner = {results: [], run: async (name, fn, options = {}) => {
    if (options.filtered) return;
    try { await fn(); runner.results.push({name, status: 'passed'}); }
    catch (error) { runner.results.push({name, status: 'failed'}); throw error; }
  }};
  countNotionRequestsByStep(runner, {requests: count});
  request();
  await runner.run('setup', async () => { request(); request(); });
  await runner.run('filtered', request, {filtered: true});
  await assert.rejects(runner.run('failure', async () => { request(); throw new Error('broken'); }), /broken/);
  assert.deepEqual(runner.results, [
    {name: 'setup', status: 'passed', notionRequests: 2},
    {name: 'failure', status: 'failed', notionRequests: 1},
  ]);
  assert.equal(count.snapshot().total, 4);
});

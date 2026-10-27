// Synthetic redirect fixtures construct invented queries without retaining captured query values.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {syntheticNavigation, takeSyntheticRedirect} from '../lib/synthetic-navigation.mjs';
import {privacyFindings} from '../lib/row-case-gates.mjs';

const item = () => ({origin: 'hand-cut', pages: [{url: 'https://careers.test.example/careers', file: 'page.html'}], syntheticNavigation: {queryKeys: ['job'], dropQueryOnce: true}});

test('only invented values are constructed and the stored fixture stays query-free', () => {
  const fixture = item(), navigation = syntheticNavigation(fixture);
  assert.equal(navigation.startUrl, `${fixture.pages[0].url}?job=fixture-job`);
  assert.deepEqual(privacyFindings({'case.json': JSON.stringify(fixture)}), []);
  assert.deepEqual(privacyFindings({'case.json': JSON.stringify({pages: [{url: navigation.startUrl}]})}), ['case.json: a URL query string']);
});

test('the first request redirects without its query; restoring the query does not redirect again', () => {
  const {startUrl, redirects} = syntheticNavigation(item());
  assert.equal(takeSyntheticRedirect(startUrl, redirects), 'https://careers.test.example/careers');
  assert.equal(takeSyntheticRedirect(startUrl, redirects), null);
});

test('the page server sends an actual 302, then serves the fixture on a restored query', async () => {
  const {answerPage} = await import('../lib/page-replay.mjs');
  const {startUrl, redirects} = syntheticNavigation(item()), responses = [];
  const route = {request: () => ({url: () => startUrl}), fulfill: response => responses.push(response)};
  const files = new Map([['careers.test.example/careers', '<h1>Fixture</h1>']]);
  await answerPage(route, files, new Map(), new Map(), redirects);
  await answerPage(route, files, new Map(), new Map(), redirects);
  assert.deepEqual(responses[0], {status: 302, headers: {location: 'https://careers.test.example/careers'}, body: ''});
  assert.equal(responses[1].status, 200);
  assert.equal(responses[1].body, '<h1>Fixture</h1>');
});

test('a plain request does not consume the pending query redirect', () => {
  const fixture = item(), {startUrl, redirects} = syntheticNavigation(fixture);
  assert.equal(takeSyntheticRedirect(fixture.pages[0].url, redirects), null);
  assert.equal(takeSyntheticRedirect('https://other.example/careers?job=fixture-job', redirects), null);
  assert.equal(takeSyntheticRedirect(startUrl, redirects), fixture.pages[0].url);
});

test('captured hosts, stored query values and extra metadata fail closed', () => {
  for (const change of [
    x => { x.origin = 'captured'; },
    x => { x.pages[0].url = 'https://real-employer.com/careers'; },
    x => { x.pages[0].url += '?original=value'; },
    x => { x.syntheticNavigation.queryKeys = ['job&token']; },
    x => { x.syntheticNavigation.queryValues = ['original-value']; },
    x => { x.syntheticNavigation.queryKeys = []; },
  ]) {
    const fixture = item(); change(fixture);
    assert.throws(() => syntheticNavigation(fixture), /synthetic navigation/i);
  }
});

test('ordinary recorded cases keep their address and have no redirect', () => {
  const fixture = {pages: [{url: 'https://employer.com/apply'}]};
  assert.deepEqual(syntheticNavigation(fixture), {startUrl: fixture.pages[0].url, redirects: new Map()});
});

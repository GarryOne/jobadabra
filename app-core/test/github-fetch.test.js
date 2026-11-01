// A repo move makes GitHub answer 301; a POST must be re-sent as a POST to the new path (src/github-fetch.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {githubFetch} from '../src/github-fetch.js';

const OLD = 'https://api.github.com/repos/GarryOne/jobadabra/actions/workflows/e2e.yml/dispatches';
const NEW = 'https://api.github.com/repositories/123/actions/workflows/e2e.yml/dispatches';
const INIT = {method: 'POST', headers: {Authorization: 'Bearer t'}, body: '{"ref":"main"}'};

/** A fake GitHub: the old path answers 301 to NEW; NEW accepts only a POST with the body (a GET is the 404 we saw). */
function fakeGithub(log) {
  return async (url, init) => {
    log.push({url, method: init.method, body: init.body, redirect: init.redirect, auth: init.headers?.Authorization});
    if (url === OLD) return new Response(null, {status: 301, headers: {location: NEW}});
    if (url === NEW && init.method === 'POST' && init.body === INIT.body) return new Response(null, {status: 204});
    return new Response('Not Found', {status: 404});
  };
}

test('a 301 on a POST is followed with the same method, headers and body', async () => {
  const log = [];
  const response = await githubFetch(OLD, INIT, fakeGithub(log));
  assert.equal(response.status, 204);
  assert.deepEqual(log.map(call => [call.url, call.method, call.body, call.auth]), [
    [OLD, 'POST', INIT.body, 'Bearer t'],
    [NEW, 'POST', INIT.body, 'Bearer t'],
  ]);
  assert.ok(log.every(call => call.redirect === 'manual'), 'redirects are handled here, never by fetch (it would turn the POST into a GET)');
});

test('positive control: plain fetch semantics (a redirected POST becoming a GET) would have got the 404', async () => {
  const fake = fakeGithub([]);
  assert.equal((await fake(NEW, {method: 'GET'})).status, 404);
});

test('307 and 308 are followed too, and a relative Location is resolved', async () => {
  for (const status of [307, 308]) {
    const seen = [];
    const fetcher = async (url, init) => {
      seen.push([url, init.method]);
      return url === OLD
        ? new Response(null, {status, headers: {location: '/repositories/123/actions/workflows/e2e.yml/dispatches'}})
        : new Response(null, {status: 204});
    };
    assert.equal((await githubFetch(OLD, INIT, fetcher)).status, 204);
    assert.deepEqual(seen, [[OLD, 'POST'], [NEW, 'POST']]);
  }
});

test('a Location outside api.github.com is not followed: the token never leaves GitHub', async () => {
  const seen = [];
  const fetcher = async url => { seen.push(url); return new Response(null, {status: 301, headers: {location: 'https://evil.example/x'}}); };
  const response = await githubFetch(OLD, INIT, fetcher);
  assert.equal(response.status, 301);
  assert.deepEqual(seen, [OLD]);
});

test('a redirect without a Location is returned as it is', async () => {
  const response = await githubFetch(OLD, INIT, async () => new Response(null, {status: 301}));
  assert.equal(response.status, 301);
});

test('more than 3 hops stop with an error instead of looping', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, {status: 301, headers: {location: OLD}}); };
  await assert.rejects(githubFetch(OLD, INIT, fetcher), /more than 3 times/);
  assert.equal(calls, 4);
});

test('a normal answer (no redirect) passes through, GET included', async () => {
  const response = await githubFetch(OLD, {}, async (url, init) => new Response(init.method ?? 'GET', {status: 200}));
  assert.equal(response.status, 200);
});

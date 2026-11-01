// "Open in my browser" (lib/ready-handoff.js): the night's hand-off waits for the extension's one ask, under each address its tab may show first,
// and only the page's own site's cookies go with it (the night's browser also held other sites' cookies).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clear, cookiesFor, forExtension, keep, keepForJob, pageKey, take} from '../lib/ready-handoff.js';

const PAGE = 'https://job-boards.greenhouse.io/doctolib/jobs/7819133003?gh_src=x#jobpilotto-fill=s1';
const HANDOFF = {url: 'https://job-boards.greenhouse.io/doctolib/jobs/7819133003',
  storage: {cookies: [
    {name: 'gh_session', value: 'a', domain: 'job-boards.greenhouse.io', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax'},
    {name: '_ga', value: 'b', domain: '.greenhouse.io', path: '/', expires: 1792300000, httpOnly: false, secure: true, sameSite: 'None'},
    {name: 'other', value: 'c', domain: '.ashbyhq.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax'},
  ], origins: [{origin: 'https://job-boards.greenhouse.io', localStorage: [{name: 'draft', value: '1'}]}, {origin: 'https://jobs.ashbyhq.com', localStorage: [{name: 'x', value: 'y'}]}]},
  sessionStorage: {step: '1'}, snapshot: {fields: [{id: 'first_name', name: 'job_application[first_name]', type: 'text', value: 'Ada'}], files: [{slot: 'resume', name: 'CV.pdf', size: 10}]}};

test('a page key drops the mark, the query and a trailing slash', () => {
  assert.equal(pageKey(PAGE), 'https://job-boards.greenhouse.io/doctolib/jobs/7819133003');
  assert.equal(pageKey(`${HANDOFF.url}/`), pageKey(HANDOFF.url));
  assert.equal(pageKey('not a url'), '');
});

test('only the page\'s own site\'s cookies go, shaped for chrome.cookies.set', () => {
  const cookies = cookiesFor(HANDOFF.url, HANDOFF.storage.cookies);
  assert.deepEqual(cookies.map(c => c.name), ['gh_session', '_ga']);
  assert.deepEqual(cookies[0], {url: 'https://job-boards.greenhouse.io/', name: 'gh_session', value: 'a', path: '/', secure: true, httpOnly: true, sameSite: 'lax'});
  assert.equal(cookies[1].domain, '.greenhouse.io');
  assert.equal(cookies[1].sameSite, 'no_restriction');
  assert.equal(cookies[1].expirationDate, 1792300000);
});

test('the extension gets the page, its cookies, its own origin\'s storage and the snapshot', () => {
  const ready = forExtension(HANDOFF);
  assert.equal(ready.url, HANDOFF.url);
  assert.deepEqual(ready.localStorage, {draft: '1'});
  assert.deepEqual(ready.sessionStorage, {step: '1'});
  assert.equal(ready.snapshot.fields[0].value, 'Ada');
  assert.equal(forExtension({url: 'nope'}), null);
});

test('kept under the job link, its form address and the night\'s page; taken once, by any of them', () => {
  for (const asked of ['https://boards.example.com/acme/123', 'https://boards.example.com/acme/123/apply#jobpilotto-fill=s9', PAGE]) {
    clear();
    assert.ok(keep(HANDOFF, ['https://boards.example.com/acme/123', 'https://boards.example.com/acme/123/apply']));
    assert.equal(take(asked)?.url, HANDOFF.url, asked);
    for (const again of ['https://boards.example.com/acme/123', PAGE]) assert.equal(take(again), null, `${asked} then ${again}: gone`);
  }
});

test('keepForJob keeps it under the job link and its form address, so a session reopened from the posting never names the form address', () => {
  const job = 'https://jobs.lever.co/acme/5e2e5e2e-0000-4000-8000-00000000a001';   // formUrl maps a Lever posting by its UUID
  for (const asked of [job, `${job}/apply`]) {
    clear();
    assert.ok(keepForJob(HANDOFF, job));
    assert.equal(take(asked)?.url, HANDOFF.url, asked);
  }
});

test('a hand-off nobody asked for in 10 minutes is dropped', () => {
  clear();
  keep(HANDOFF, [], 0);
  assert.equal(take(PAGE, 11 * 60 * 1000), null);
});

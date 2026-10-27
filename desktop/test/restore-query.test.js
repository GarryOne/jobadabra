// A redirect that drops the posting address's query string (http -> https on an employer page that embeds a job board: the embed reads the job id from that query and
// otherwise shows the whole list) is undone once: the same page is opened with the posting's own query (fair round W44, form 264402, 27 Oct 2026; proven on a plain
// GET: the https address with the query opens the application frame, the redirected one the list). Structure only: addresses compared, no page word.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const posting = 'http://careers.example.test/careers?gh_jid=4932950101';

test('the address to open: the same page with the posting\'s query, the tab\'s own mark kept; nothing when no query was lost', async () => {
  const {restoredQueryUrl} = await import('../../extension/restore-query.js');
  assert.equal(restoredQueryUrl('https://careers.example.test/careers#jobpilotto-fill=s9', posting), 'https://careers.example.test/careers?gh_jid=4932950101#jobpilotto-fill=s9');
  assert.equal(restoredQueryUrl('https://www.careers.example.test/careers/', 'http://careers.example.test/careers?a=1&b=2'), 'https://www.careers.example.test/careers/?a=1&b=2', 'www and a trailing slash are the same page');
  assert.equal(restoredQueryUrl('https://careers.example.test/careers?gh_jid=4932950101', posting), '', 'the query survived: nothing to restore');
  assert.equal(restoredQueryUrl('https://careers.example.test/careers?lang=en', posting), '', 'the page has a query of its own: not ours to replace');
  assert.equal(restoredQueryUrl('https://careers.example.test/apply/form', posting), '', 'another page of the application: never');
  assert.equal(restoredQueryUrl('https://other.example.test/careers', posting), '', 'another site: never');
  assert.equal(restoredQueryUrl('https://careers.example.test/careers', 'http://careers.example.test/careers'), '', 'the posting had no query');
  assert.equal(restoredQueryUrl('chrome://newtab/', posting), '');
});

test('it is opened once per tab and posting, never in a loop', async () => {
  const stored = {}, moves = [], said = [];
  globalThis.chrome = {storage: {session: {}}};
  const store = {get: async key => ({[key]: stored[key]}), set: async values => Object.assign(stored, values)};
  const {restoreLostQuery} = await import('../../extension/restore-query.js');
  const {noteRequested} = await import('../../extension/requested-url.js');
  const tab = {id: 7, url: 'https://careers.example.test/careers#jobpilotto-fill=s9'};
  const redirectedJob = 'https://careers.example.test/careers';   // what the tab's own first look saw: the job the app asked for is only in the navigation's request
  await noteRequested({frameId: 0, tabId: 7, url: `${posting}#jobpilotto-fill=s9`}, store);
  await noteRequested({frameId: 0, tabId: 8, url: `${posting}#jobpilotto-fill=s9`}, store);
  const go = (on = tab) => restoreLostQuery(on, redirectedJob, {decide: (_, line) => said.push(line), move: async (id, url) => moves.push([id, url]), store});
  assert.equal(await go(), true);
  assert.deepEqual(moves, [[7, 'https://careers.example.test/careers?gh_jid=4932950101#jobpilotto-fill=s9']]);
  assert.equal(await go(), false, 'the redirect strips it again: the page is read as it is');
  assert.equal(await go({id: 8, url: tab.url}), true, 'another tab is its own application');
  assert.ok(said.every(line => line === 'a redirect dropped the posting\'s query: opened the page again with it'));
});

test('what the app asked for is noted per tab, from the top frame of an app-opened navigation only', async () => {
  const {requestedOfNavigation} = await import('../../extension/requested-url.js');
  assert.equal(requestedOfNavigation({frameId: 0, url: 'http://careers.example.test/careers?gh_jid=1#jobpilotto-fill=s9'}), 'http://careers.example.test/careers?gh_jid=1');
  assert.equal(requestedOfNavigation({frameId: 0, url: 'http://careers.example.test/careers?gh_jid=1#jobpilotto-fill'}), 'http://careers.example.test/careers?gh_jid=1');
  assert.equal(requestedOfNavigation({frameId: 3, url: 'http://careers.example.test/careers?gh_jid=1#jobpilotto-fill'}), '', 'a frame\'s navigation is not the tab\'s');
  assert.equal(requestedOfNavigation({frameId: 0, url: 'http://careers.example.test/careers?gh_jid=1'}), '', 'a page the app did not open');
  assert.equal(requestedOfNavigation({frameId: 0, url: 'chrome://newtab/#jobpilotto-fill'}), '');
});

test('the flow asks it before the page is read, once the tab is its own read', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  assert.match(flow, /started\.add\(key\);\n  if \(await restoreLostQuery\(tab, jobUrl, \{decide\}\)\) return;/);
});

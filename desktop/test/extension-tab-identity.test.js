// A tab's identity (extension/tab-identity.js): its job is the posting it was opened for, not the page it is on; the session the app answered is kept on the tab.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const store = {};
globalThis.chrome = {runtime: {getManifest: () => ({version: 'test'}), sendMessage: async () => {}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {
  async get(keys) { const list = [].concat(keys); return Object.fromEntries(list.filter(key => key in store).map(key => [key, store[key]])); },
  async set(items) { Object.assign(store, items); }, async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }}}};
const {bindSession, identityOf, jobOf} = await import('../../extension/tab-identity.js');

const POSTING = 'https://www.jobs.ch/en/vacancies/detail/12181ac1/', SIGNIN = 'https://auth.jobs.ch/u/login/identifier?state=x#jobpilotto-fill';

test('a sign-in tab with no session yet: its job is the posting that led to it; the answered session is kept and then carried', async () => {
  store['from:7'] = POSTING;
  assert.deepEqual(await identityOf({id: 7, url: SIGNIN}), {session: '', job: POSTING, url: 'https://auth.jobs.ch/u/login/identifier?state=x', boot: ''});
  assert.equal(await bindSession(7, 'f8ddb7ed', ''), true);
  assert.equal((await identityOf({id: 7, url: SIGNIN})).session, 'f8ddb7ed');
  assert.equal(await bindSession(7, 'f8ddb7ed', 'f8ddb7ed'), false, 'the same id is not written again');
  assert.equal(await bindSession(7, '', 'f8ddb7ed'), false, 'an empty answer never clears what the tab carries');
});

test('job: the job key wins over from, and a tab with neither is its own page', async () => {
  store['job:8'] = 'https://a.example/job/1'; store['from:8'] = 'https://b.example/job/2';
  assert.equal(await jobOf({id: 8, url: 'https://c.example/'}), 'https://a.example/job/1');
  assert.equal(String(await jobOf({id: 9, url: 'https://c.example/apply'})).startsWith('https://c.example'), true);
});

test('one owner: no extension file but tab-identity.js builds a session:/job:/from: key name (spec step 3)', async () => {
  const fs = await import('node:fs');
  const dir = new URL('../../extension/', import.meta.url);
  const offenders = fs.readdirSync(dir).filter(name => name.endsWith('.js') && name !== 'tab-identity.js')
    .filter(name => /`(session|job|from):\$\{/.test(fs.readFileSync(new URL(name, dir), 'utf8')));
  assert.deepEqual(offenders, [], 'use KEY / the helpers of extension/tab-identity.js');
});

// A worker that boots after the app's tab opened (a cold Chrome, a worker waking: 14 Oct 2026, Windows e2e: the tab's mark event was missed): its settling pass binds the tab's
// posting and session from the mark, so the page the tab moves to next still has its job (and its kit). A tab that already has its job is left alone.
test('a slow-boot worker takes the posting and session from the mark of a tab it never saw open', async () => {
  const {createSettleOpenTabs} = await import('../../extension/settle-tabs.js');
  const marked = 'https://boards.example/jobs/1#jobpilotto-fill=ca582c3c', armedTabs = [];
  globalThis.chrome.tabs = {query: async () => [{id: 21, url: marked}, {id: 22, url: 'https://boards.example/jobs/2#jobpilotto-fill=feedbeef'}]};
  store['from:22'] = 'https://boards.example/jobs/OTHER';
  await createSettleOpenTabs({arm: async id => { armedTabs.push(id); }, memoryReady: () => Promise.resolve()})();
  assert.deepEqual(armedTabs, [21, 22]);
  assert.equal(store['from:21'], 'https://boards.example/jobs/1', 'the posting the tab was opened for');
  assert.equal(store['session:21'], 'ca582c3c', 'the session the app opened it for');
  assert.equal(store['from:22'], 'https://boards.example/jobs/OTHER', 'a tab with its job is not rewritten');
});

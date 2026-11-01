// A session's tab is owned at first sight: the session id rides in the tab's own address (#jobpilotto-fill=<id>), so no later guess is needed
// (owner, 12 Oct 2026; spec docs/superpowers/specs/2026-10-12-tab-owned.md). Scenario rows 1, 2, 3, 7 of its matrix; each fails on the build before it.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const store = {};
globalThis.chrome = {runtime: {getManifest: () => ({version: 'test'}), sendMessage: async () => {}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {
  async get(keys) { const list = [].concat(keys); return Object.fromEntries(list.filter(key => key in store).map(key => [key, store[key]])); },
  async set(items) { Object.assign(store, items); }, async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }}}};
const {identityOf} = await import('../../extension/tab-identity.js');
const {parseMark, stripMark, withMark, pageKey} = await import('../../extension/tab-pages.js');
const {prompt} = await import('../lib/claude-session.js');

const FORM = 'https://apply.example-ats.test/acme/42/apply';
const clear = () => { for (const key of Object.keys(store)) delete store[key]; };

test('the mark carries the session id, and every reader of the address still sees the same page', () => {
  assert.equal(parseMark(`${FORM}#jobpilotto-fill=ab12cd34`), 'ab12cd34');
  assert.equal(parseMark(`${FORM}#jobpilotto-fill`), '');
  assert.equal(parseMark(FORM), '');
  assert.equal(stripMark(`${FORM}#jobpilotto-fill=ab12cd34`), FORM);
  assert.equal(stripMark(`${FORM}#jobpilotto-fill`), FORM);
  assert.equal(pageKey(`${FORM}#jobpilotto-fill=ab12cd34`), FORM);
  assert.equal(withMark(FORM, 'jobpilotto-fill=ab12cd34'), `${FORM}#jobpilotto-fill=ab12cd34`);
});

test('row 2, Claude\'s own tab: owned at first sight by the id in the address, before the app ever answered', async () => {
  clear();
  const id = await identityOf({id: 7, url: `${FORM}#jobpilotto-fill=ab12cd34`});
  assert.equal(id.session, 'ab12cd34');
});

test('row 3, Chrome restart: the memory is gone, the restored address still names the session', async () => {
  clear();
  assert.equal((await identityOf({id: 3, url: `${FORM}#jobpilotto-fill=ab12cd34`})).session, 'ab12cd34');
});

test('row 7, email-first sign-in moves the tab to another host: the carried mark keeps the session', async () => {
  clear();
  assert.equal((await identityOf({id: 7, url: 'https://signin.other-host.test/ap/signin#jobpilotto-fill=ab12cd34'})).session, 'ab12cd34');
});

test('row 1, a redirect drops the hash: the session stored on the tab still wins', async () => {
  clear(); store['session:7'] = 'ab12cd34';
  assert.equal((await identityOf({id: 7, url: 'https://signin.other-host.test/ap/signin'})).session, 'ab12cd34');
});

test('the hand-off tells Claude to open its one tab with the session in the mark, and to keep it on every address', () => {
  const text = prompt('https://jobs.example.com/1', {auditFile: 'a.json', session: 'ab12cd34'});
  assert.ok(text.includes('https://jobs.example.com/1#jobpilotto-fill=ab12cd34'));
  assert.ok(!/#jobpilotto-fill[^=]/.test(text), 'no bare mark left in the instructions');
});
